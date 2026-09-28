import {getOidcProviders} from './oidc-providers.js'
import {isOutboundEmailEnabled} from './email-configuration.js'

export const DefaultIdpDisplayName = 'Passmower'

// The name an application puts on its login button ("Sign in with <name>").
// IDP_DISPLAY_NAME wins when set. Otherwise a lone federated upstream names
// itself; any other mix, including magic-link email beside an upstream, is
// signed in "with Passmower". Passkeys do not count: they only unlock an
// account an upstream or email login already created.
export const resolveIdpDisplayName = (env = process.env) => {
    const override = env.IDP_DISPLAY_NAME?.trim()
    if (override) return override

    const upstreams = [
        ...(env.GITHUB_ENABLED !== 'false' ? ['GitHub'] : []),
        ...getOidcProviders().map(p => p.displayName),
    ]
    if (upstreams.length === 1 && !isOutboundEmailEnabled(env)) return upstreams[0]
    return DefaultIdpDisplayName
}
