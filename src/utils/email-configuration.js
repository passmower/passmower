export const isEmailEnabled = (env = process.env) => env.EMAIL_ENABLED !== 'false'

const requiredEmailEnvironment = [
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_SSL',
]

export function validateEmailConfiguration(env = process.env) {
    if (!isEmailEnabled(env)) return
    const missing = requiredEmailEnvironment.filter(key => !env[key])
    if (missing.length) {
        throw new Error(`Email is enabled but required configuration is missing: ${missing.join(', ')}`)
    }
    // Unauthenticated SMTP (an internal relay, MailHog in dev) is legal:
    // credentials are optional, but must come as a pair, and without a
    // username there is no fallback sender address, so EMAIL_FROM is required.
    if (Boolean(env.EMAIL_USERNAME) !== Boolean(env.EMAIL_PASSWORD)) {
        throw new Error('EMAIL_USERNAME and EMAIL_PASSWORD must be set together')
    }
    if (!env.EMAIL_USERNAME && !env.EMAIL_FROM) {
        throw new Error('EMAIL_FROM is required when SMTP authentication is not configured')
    }
}
