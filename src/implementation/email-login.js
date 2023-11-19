import Account from "../support/account.js";
import { randomUUID } from 'crypto';
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import EmailAdapter from "../adapters/email.js";
import {CustomOIDCProviderError} from "oidc-provider/lib/helpers/errors.js";
import {getEmailContent, getEmailSubject} from "../support/get-email-content.js";
import {SlackAdapter} from "../adapters/slack.js";
import {parseRequestMetadata} from "../support/parse-request-headers.js";
import {auditLog} from "../support/audit-log.js";

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
            gateway: process.env.ISSUER_URL,
            email,
            client: client?.displayName || client?.clientId,
            client_url: client?.uri || client?.redirectUris[0],
            browser: metadata.browser,
            ip: metadata.ip
        })
        const emailSent = await this.adapter.sendMail(
            email,
            getEmailSubject('emails/link'),
            content.text,
            content.html
        )
        auditLog(ctx, {email}, 'Sent login link via email')
        if (this.slackAdapter.client && account?.slackId) {
            await this.slackAdapter.sendMessage(account.slackId, content.text)
            auditLog(ctx, {email, slackId: account.slackId}, 'Sent login link via Slack')
            return ctx.redirect(`${process.env.ISSUER_URL}interaction/${uid}/email-sent`)
        } else if (!emailSent) {
            auditLog(ctx, {email, error: true}, 'Failed to send login link via email')
            throw new CustomOIDCProviderError('email_sending_failed', 'Failed to send login link via email. Please try again or contact support.')
        }
        return ctx.redirect(`${process.env.ISSUER_URL}interaction/${uid}/email-sent`)
    }

    async verifyLink(ctx, provider) {
        const params = ctx.request.params
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
        if (!interactionDetails.result || interactionDetails.result.token !== params.token || interactionDetails.jti !== params.uid) {
            auditLog(ctx, {interactionDetails, params, error: true}, 'Invalid login link')
            return accessDenied(ctx, provider, 'Invalid login link')
        }

        const account = await Account.createOrUpdateByEmails(
            ctx,
            provider,
            interactionDetails.result.email
        );

        if (!account) {
            auditLog(ctx,{interactionDetails, params}, 'Unable to determine account from login link')
        }

        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, 'LoginLink'), {
            mergeWithLastSubmission: true,
        });
    }
}
