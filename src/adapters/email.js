import Nodemailer from "nodemailer";
import {isEmailEnabled, validateEmailConfiguration} from '../utils/email-configuration.js';

class EmailAdapter {
    #transporter

    async sendMail(to, subject, textContent, htmlContent) {
        if (!isEmailEnabled()) throw new Error('Email delivery is disabled')
        validateEmailConfiguration()
        this.#transporter ??= Nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            ssl: process.env.EMAIL_SSL,
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            }
        })
        return await this.#transporter.sendMail({
            to,
            subject,
            headers: {
                From: `${process.env.EMAIL_FROM || process.env.EMAIL_USERNAME} <${process.env.EMAIL_USERNAME}>`,
            },
            text: textContent,
            html: htmlContent
        })
    }
}

export default EmailAdapter
