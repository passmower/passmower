// Vitest setup file: establishes the minimum environment every src module needs
// to be *imported* (configuration.js evaluates OIDC_COOKIE_KEYS / OIDC_JWKS at
// module load). Individual tests override these as needed.
import { generateKeyPairSync } from 'node:crypto'

function ephemeralJwks() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = privateKey.export({ format: 'jwk' })
    jwk.use = 'sig'
    jwk.alg = 'RS256'
    jwk.kid = 'test-key'
    return [jwk]
}

process.env.ISSUER_URL ??= 'https://oidc.test.example.com/'
process.env.OIDC_COOKIE_KEYS ??= JSON.stringify(['test-cookie-secret-0123456789abcdef0123456789'])
process.env.OIDC_JWKS ??= JSON.stringify(ephemeralJwks())
process.env.DEPLOYMENT_NAME ??= 'passmower-test'

// Upstream auth methods that reach external services are off unless a test opts in.
process.env.GITHUB_ENABLED ??= 'false'
process.env.EMAIL_ENABLED ??= 'false'
process.env.WEBAUTHN_ENABLED ??= 'false'
