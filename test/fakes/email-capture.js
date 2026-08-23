// Mock for src/adapters/email.js: instead of sending SMTP, capture messages so
// tests can read the magic-link out of the rendered email.
export const sentEmails = []

export default class EmailAdapter {
    async sendMail(to, subject, text, html) {
        sentEmails.push({ to, subject, text, html })
        return true
    }
}
