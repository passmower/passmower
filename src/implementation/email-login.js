import Account from "../support/account.js";
import Nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import RedisAdapter from "../adapters/redis.js";
import { renderFile } from 'ejs';
import path from "path";
import {dirname} from "desm";

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
        this.redis = new RedisAdapter('links')
    }


    async sendLink(ctx, provider)
    {
        const {uid} = await provider.interactionDetails(ctx.req, ctx.res);
        const email = ctx.request.body.email
        const token = randomUUID()
        const url = `${process.env.ISSUER}interaction/${uid}/verify-email/${token}`
        await this.redis.upsert(token, {
            email: email,
            uid: uid,
        }, 3600)
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
        return ctx.redirect(`${process.env.ISSUER}interaction/${uid}/email-sent`)
    }

    async verifyLink(ctx, provider) {
        const verification = await this.redis.find(ctx.request.params.token)
        const account = await Account.createOrUpdateByEmails(
            ctx,
            [verification.email],
            {
                sub: verification.email,
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