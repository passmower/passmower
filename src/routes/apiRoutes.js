/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from '@koa/router';
import {signedInToSelf} from "../utils/session/signed-in.js";
import {checkAccountGroups} from "../utils/user/check-account-groups.js";
import {getEnrolledApps, listAllApps} from "../utils/apps/list-apps.js";
import {renderMarkdown} from "../utils/markdown.js";
import {accountFromBearer} from "../utils/session/bearer-account.js";
import {auditLog} from "../utils/session/audit-log.js";
import validator, {
    checkCompanyName, checkDisableFrontendEdit,
    checkRealName,
    restValidationErrors
} from "../utils/session/validator.js";
import {getText} from "../utils/get-text.js";
import {WebAuthnService} from "../services/webauthn/index.js";

export default (provider) => {
    const router = new Router();

    // Catalog of every enrolled app, for cluster-overview apps (e.g. Driftmower).
    // Registered before the site-session gate below so it is authenticated by a
    // Bearer access token instead. Gated twice: the token must carry the
    // `all_applications` scope, and the user must be an admin.
    router.get('/api/apps/all', async (ctx) => {
        const {account, status} = await accountFromBearer(ctx, provider, 'all_applications')
        if (status) {
            ctx.status = status
            return
        }
        if (!account.isAdmin) {
            ctx.status = 403
            return
        }
        ctx.body = {
            apps: await listAllApps(account)
        }
    })

    router.use(bodyParser({ json: true }))
    router.use(validator())
    router.use(async (ctx, next) => {
        const session = await signedInToSelf(ctx, provider)
        if (session) {
            return next()
        }
    })

    router.get('/api/me', async (ctx, next) => {
        const account = ctx.currentAccount
        ctx.body = {
            ...account.getProfileResponse(),
            disableEditing: process.env.DISABLE_FRONTEND_EDIT === 'true',
        }
    })

    router.get('/api/texts/disable_frontend_edit', async (ctx, next) => {
        ctx.body = getText('disable_frontend_edit')
    })

    router.post('/api/me', async (ctx, next) => {
        checkRealName(ctx)
        checkCompanyName(ctx)
        checkDisableFrontendEdit(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }

        const accountId = ctx.currentSession.accountId
        const body = ctx.request.body
        const account = await ctx.kubeOIDCUserService.updateUserSpecs(
            accountId,
            {
            passmower: {
                name: body.name,
                company: body.company,
            }
        })
        auditLog(ctx, {accountId, body}, 'User updated profile')
        ctx.body = account.getProfileResponse()
    })

    router.get('/api/sessions', async (ctx, next) => {
        let sessions = await ctx.sessionService.getSessions(ctx.currentSession.accountId, ctx.currentSession)
        ctx.body = {
            sessions
        }
    })

    router.post('/api/session/end', async (ctx, next) => {
        // TODO: maybe validate but security is provided by sessionService anyway.
        const sessionToDelete = ctx.request.body.id
        const sessions = await ctx.sessionService.endSession(sessionToDelete, ctx, next, provider)
        auditLog(ctx, {sessionToDelete}, 'User ended session')
        ctx.body = {
            sessions
        }
        if (ctx.currentSession.jti === sessionToDelete) {
            ctx.redirect('/')
        }
    })

    router.get('/api/apps', async (ctx, next) => {
        const clients = (await getEnrolledApps())
            .filter(c => checkAccountGroups(c, ctx.currentAccount))
        let apps = await Promise.all(clients.map(async c => {
            return {
                name: c.displayName ?? c.client_name,
                url: c.uri,
                displayOrder: c.displayOrder ?? 0,
                description: renderMarkdown(c.description),
                metadata: await ctx.sessionService.getLastSessionInfoPerClient(ctx.currentSession.accountId, c.client_id)
            }
        }))
        apps.sort((a, b) => (a.displayOrder - b.displayOrder) || a.name.localeCompare(b.name))
        ctx.body = {
            apps
        }
    })

    // ============================================
    // Passkey/WebAuthn Management Routes
    // ============================================

    // List user's passkeys
    router.get('/api/passkeys', async (ctx) => {
        const webauthn = new WebAuthnService(ctx.kubeOIDCUserService);
        const passkeys = webauthn.listPasskeys(ctx.currentAccount);
        ctx.body = { passkeys };
    })

    // Start passkey registration
    router.post('/api/passkeys/register/start', async (ctx) => {
        const webauthn = new WebAuthnService(ctx.kubeOIDCUserService);
        try {
            const options = await webauthn.startRegistration(ctx.currentAccount);
            auditLog(ctx, { accountId: ctx.currentAccount.accountId }, 'Passkey registration started');
            ctx.body = options;
        } catch (error) {
            globalThis.logger?.error({ error }, 'Failed to start passkey registration');
            ctx.status = 500;
            ctx.body = { error: 'Failed to start registration' };
        }
    })

    // Complete passkey registration
    router.post('/api/passkeys/register/finish', async (ctx) => {
        const webauthn = new WebAuthnService(ctx.kubeOIDCUserService);
        const { response, name } = ctx.request.body;

        if (!response) {
            ctx.status = 400;
            ctx.body = { error: 'Missing response' };
            return;
        }

        try {
            const result = await webauthn.finishRegistration(
                ctx.currentAccount,
                response,
                name || 'Passkey'
            );

            if (result.verified) {
                auditLog(ctx, {
                    accountId: ctx.currentAccount.accountId,
                    credentialId: result.credential?.id,
                    name: name
                }, 'Passkey registered successfully');
                ctx.body = {
                    verified: true,
                    credential: {
                        id: result.credential.id,
                        name: result.credential.name,
                        createdAt: result.credential.createdAt,
                    }
                };
            } else {
                ctx.status = 400;
                ctx.body = { verified: false, error: 'Verification failed' };
            }
        } catch (error) {
            globalThis.logger?.error({ error }, 'Failed to complete passkey registration');
            ctx.status = 400;
            ctx.body = { error: error.message || 'Registration failed' };
        }
    })

    // Rename a passkey
    router.patch('/api/passkeys/:id', async (ctx) => {
        const webauthn = new WebAuthnService(ctx.kubeOIDCUserService);
        const credentialId = ctx.params.id;
        const { name } = ctx.request.body;

        if (!name || typeof name !== 'string' || name.length < 1 || name.length > 50) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid name (1-50 characters required)' };
            return;
        }

        try {
            await webauthn.renamePasskey(ctx.currentAccount.accountId, credentialId, name);
            auditLog(ctx, { accountId: ctx.currentAccount.accountId, credentialId, name }, 'Passkey renamed');
            ctx.body = { success: true };
        } catch (error) {
            globalThis.logger?.error({ error }, 'Failed to rename passkey');
            ctx.status = 404;
            ctx.body = { error: error.message || 'Passkey not found' };
        }
    })

    // Delete a passkey
    router.delete('/api/passkeys/:id', async (ctx) => {
        const webauthn = new WebAuthnService(ctx.kubeOIDCUserService);
        const credentialId = ctx.params.id;

        try {
            await webauthn.removePasskey(ctx.currentAccount.accountId, credentialId);
            auditLog(ctx, { accountId: ctx.currentAccount.accountId, credentialId }, 'Passkey deleted');
            ctx.body = { success: true };
        } catch (error) {
            globalThis.logger?.error({ error }, 'Failed to delete passkey');
            ctx.status = 404;
            ctx.body = { error: error.message || 'Passkey not found' };
        }
    })

    return router;
};
