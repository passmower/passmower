import Account from "../support/account.js";
import { randomUUID } from 'crypto';
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import EmailAdapter from "../adapters/email.js";
import {CustomOIDCProviderError} from "oidc-provider/lib/helpers/errors.js";
import {getEmailContent, getEmailSubject} from "../support/get-email-content.js";

export class EmailLogin {
    constructor() {
        this.adapter = new EmailAdapter()
    }

    async sendLink(ctx, provider)
    {
        const {uid} = await provider.interactionDetails(ctx.req, ctx.res);
        const email = ctx.request.body.email
        if (process.env.ENROLL_USERS === 'false' && !await Account.findByEmail(ctx, email)) {
            return accessDenied(ctx, provider, 'Account doesn\'t exist')
        }
        const token = randomUUID()
        const url = `${process.env.ISSUER_URL}interaction/${uid}/verify-email/${token}`
        await provider.interactionResult(ctx.req, ctx.res, {
            email,
            token,
            request: ctx.request,
        })

        const content = await getEmailContent('emails/link', {
            url
        })
        const emailSent = await this.adapter.sendMail(
            email,
            getEmailSubject('emails/link'),
            content.text,
            content.html
        )
        if (!emailSent) {
            throw new CustomOIDCProviderError('email_sending_failed', 'Failed to send login link via email. Please try again or contact support.')
        }
        return ctx.redirect(`${process.env.ISSUER_URL}interaction/${uid}/email-sent`)
    }

    async verifyLink(ctx, provider) {
        const params = ctx.request.params
        const details = await provider.interactionDetails(ctx.req, ctx.res)
        if (!details.result || details.result.token !== params.token || details.jti !== params.uid) {
            return accessDenied(ctx, provider, 'Invalid magic link')
        }

        const account = await Account.createOrUpdateByEmails(
            ctx,
            details.result.email
        );

        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account), {
            mergeWithLastSubmission: true,
        });
    }
}
