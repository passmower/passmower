import Account from "../support/account.js";
import { randomUUID } from 'crypto';
import { renderFile } from 'ejs';
import path from "path";
import {dirname} from "desm";
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import EmailAdapter from "../adapters/email.js";
import {CustomOIDCProviderError} from "oidc-provider/lib/helpers/errors.js";

export class EmailLogin {
    constructor() {
        this.adapter = new EmailAdapter()
    }

    async sendLink(ctx, provider)
    {
        const {uid} = await provider.interactionDetails(ctx.req, ctx.res);
        const email = ctx.request.body.email
        const token = randomUUID()
        const url = `${process.env.ISSUER_URL}interaction/${uid}/verify-email/${token}`
        await provider.interactionResult(ctx.req, ctx.res, {
            email,
            token
        })

        const __dirname = dirname(import.meta.url);
        const emailHtml = await renderFile(
            path.join(__dirname, '..', 'views', 'emails', 'link.ejs'),
            {
                url
            }
        );
        const emailSent = await this.adapter.sendMail(email, 'Login link', url, emailHtml)
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
            [details.result.email],
        );

        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account), {
            mergeWithLastSubmission: true,
        });
    }
}
