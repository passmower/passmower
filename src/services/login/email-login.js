import Account from "../../models/account.js";
import { randomUUID } from 'crypto';
import accessDenied from "../../utils/session/access-denied.js";
import getLoginResult from "../../utils/user/get-login-result.js";
import EmailAdapter from "../../adapters/email.js";
import {CustomOIDCProviderError} from "oidc-provider/lib/helpers/errors.js";
import {getEmailContent, getEmailSubject} from "../../utils/get-email-content.js";
import {SlackAdapter} from "../../adapters/slack.js";
import {parseRequestMetadata} from "../../utils/session/parse-request-headers.js";
import {auditLog} from "../../utils/session/audit-log.js";

export class EmailLogin {
    constructor() {
        this.adapter = new EmailAdapter()
        this.slackAdapter = new SlackAdapter()
    }

    async sendLink(ctx, provider)
    {
        const {uid, params} = await provider.interactionDetails(ctx.req, ctx.res);
        const client = await provider.Client.find(params.client_id);
        const email = ctx.request.body.email.toLowerCase()
        const account = await Account.findByEmail(ctx, email)
        if (process.env.ENROLL_USERS === 'false' && !account) {
            auditLog(ctx, {email}, 'Account doesn\'t exist')
            return accessDenied(ctx, provider, 'Account doesn\'t exist')
        }
        const token = randomUUID()
        const url = `${process.env.ISSUER_URL}interaction/${uid}/verify-email/${token}`
        await provider.interactionResult(ctx.req, ctx.res, {
            email,
            token,
            request: ctx.request,
        })
        const metadata = parseRequestMetadata(ctx.request.headers)
        const content = await getEmailContent('emails/link', {
            url,
            instance: process.env.ISSUER_URL,
            email,
            client: client?.displayName || client?.clientId,
            client_url: client?.uri || client?.redirectUris[0],
            browser: metadata.browser,
            ip: metadata.ip
        })
        const sendEmail = this.adapter.sendMail(
            email,
            getEmailSubject('emails/link'),
            content.text,
            content.html
        )
            .then(() => auditLog(ctx, {email}, 'Sent login link via email'))
            .then(() => true)
            .catch((error) => logger.error({ctx, error}, 'email-login.email_error'))

        const sendSlack = this.slackAdapter.client && account?.slackId ? this.slackAdapter.sendMessage(account.slackId, content.text)
            .then(() => auditLog(ctx, {email, slackId: account.slackId}, 'Sent login link via Slack'))
            .then(() => true)
            .catch((error) => logger.error({ctx, error}, 'email-login.slack_error'))
            : null

        const promises = await Promise.all([sendEmail, sendSlack]);
        if (promises[0] || promises[1]) {
            return ctx.redirect(`${process.env.ISSUER_URL}interaction/${uid}/link-sent?email=${promises[0] ? 'true' : 'false'}&slack=${promises[1] ? 'true' : 'false'}`)
        } else {
            throw new CustomOIDCProviderError('email_sending_failed', `Failed to send login link via email ${this.slackAdapter.client ? 'or Slack' : ''}. Please try again or contact support.`)
        }
    }

    // Open the magic link. Works on any device/browser: the interaction is
    // looked up by its uid (from the URL), not the interaction cookie. Validating
    // the token only marks the interaction as email-verified, so the original
    // device (which holds the interaction cookie and full context) can finish the
    // login via /email-complete. If the link is opened in the original browser we
    // complete immediately.
    async verifyLink(ctx, provider) {
        const {uid, token} = ctx.request.params
        const interaction = await provider.Interaction.find(uid)
        if (!interaction?.result || interaction.result.token !== token) {
            auditLog(ctx, {uid, error: true}, 'Invalid login link')
            return this.#renderMessage(ctx, 'Invalid login link',
                'This login link is invalid or has expired. Please request a new one.')
        }

        // Mark verified so the original device's polling can complete the login.
        const ttl = interaction.exp ? Math.max(1, Math.floor(interaction.exp - Date.now() / 1000)) : 3600
        interaction.result = {...interaction.result, emailVerified: true}
        await interaction.save(ttl)
        auditLog(ctx, {uid, email: interaction.result.email}, 'Email verified via login link')

        // If opened in the original browser, finish right away.
        let sameBrowser = false
        try {
            const details = await provider.interactionDetails(ctx.req, ctx.res)
            sameBrowser = details.jti === uid
        } catch { /* different device/browser — no interaction cookie */ }

        if (sameBrowser) {
            return this.completeLogin(ctx, provider, interaction.result.email)
        }
        return this.#renderMessage(ctx, 'Email verified',
            'Your email is verified. Return to the window or device where you started signing in — it will continue automatically.')
    }

    // Whether the interaction's email has been verified (polled by the original
    // device's "link sent" page).
    async isVerified(provider, uid) {
        const interaction = await provider.Interaction.find(uid)
        return !!interaction?.result?.emailVerified
    }

    // Complete the login in the original browser (interaction cookie present),
    // where account creation / username prompt have full context. Relies on the
    // server-side emailVerified flag, which only a valid token could have set.
    async completeLogin(ctx, provider, email) {
        const account = await Account.createOrUpdateByEmails(ctx, provider, email)
        if (!account) {
            auditLog(ctx, {email}, 'Unable to determine account from login link')
        }
        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, 'LoginLink'), {
            mergeWithLastSubmission: true,
        });
    }

    #renderMessage(ctx, title, message) {
        return ctx.render('message', {
            title, message, wide: false, uid: null, dbg: undefined, nonce: ctx.res.locals.cspNonce,
        })
    }
}
