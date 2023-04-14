import Account from "../support/account.js";
import Nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { renderFile } from 'ejs';
import path from "path";
import {dirname} from "desm";
import accessDenied from "../support/access-denied.js";

export class EmailLogin {
    constructor() {
        this.transporter = Nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            ssl: process.env.EMAIL_SSL,
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            }
        });
        this.mailOptions = {
            from: process.env.EMAIL_USERNAME,
            subject: 'Login link',
        };
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
        await this.transporter.sendMail(
            {
                ...this.mailOptions,
                to: email,
                text: url,
                html: emailHtml
            },
            function (error, info) {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });
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
            {
                sub: details.result.email,
            }
            );

        const result = {
            login: {
                accountId: account.accountId,
            },
        };

        return provider.interactionFinished(ctx.req, ctx.res, result, {
            mergeWithLastSubmission: true,
        });
    }
}