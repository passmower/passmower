import Nodemailer from "nodemailer";
import {isOutboundEmailEnabled, validateEmailConfiguration} from '../utils/email-configuration.js';

class EmailAdapter {
    #transporter

    async sendMail(to, subject, textContent, htmlContent) {
        if (!isOutboundEmailEnabled()) throw new Error('Email delivery is disabled')
        validateEmailConfiguration()
        this.#transporter ??= Nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            // Nodemailer's option is `secure` (implicit TLS); it has no `ssl`
            // option, so EMAIL_SSL was silently ignored and implicit TLS only
            // worked through the port-465 autodetect. Strict string compare:
            // the raw "false" string would be truthy.
            secure: process.env.EMAIL_SSL === 'true',
            // Unauthenticated relays (MailHog in dev) advertise no AUTH;
            // passing credentials anyway makes Nodemailer fail the handshake.
            auth: process.env.EMAIL_USERNAME ? {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            } : undefined
        })
        return await this.#transporter.sendMail({
            to,
            subject,
            headers: {
                From: process.env.EMAIL_USERNAME
                    ? `${process.env.EMAIL_FROM || process.env.EMAIL_USERNAME} <${process.env.EMAIL_USERNAME}>`
                    : process.env.EMAIL_FROM,
            },
            text: textContent,
            html: htmlContent
        })
    }
}

export default EmailAdapter
