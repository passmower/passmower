export const isEmailEnabled = (env = process.env) => env.EMAIL_ENABLED !== 'false'

const requiredEmailEnvironment = [
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_SSL',
    'EMAIL_USERNAME',
    'EMAIL_PASSWORD',
]

export function validateEmailConfiguration(env = process.env) {
    if (!isEmailEnabled(env)) return
    const missing = requiredEmailEnvironment.filter(key => !env[key])
    if (missing.length) {
        throw new Error(`Email is enabled but required configuration is missing: ${missing.join(', ')}`)
    }
}
