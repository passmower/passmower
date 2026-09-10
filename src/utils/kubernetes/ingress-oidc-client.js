import {OIDCClientCrd} from './kube-constants.js'

// Discovery of applications from Ingress annotations, the way Traefik and
// external-dns are configured (#35). An annotated Ingress is turned into an
// OIDCClient owned by that Ingress, and from there the existing client operator
// does everything it already does — generate the Secret, register the client,
// report status, list it in the launcher. There is only one client code path,
// and deleting the Ingress garbage-collects the client with it.
export const ANNOTATION_PREFIX = 'codemowers.io/oidc-'
export const annotation = (suffix) => `${ANNOTATION_PREFIX}${suffix}`

// The label that marks a generated client as ours to manage. A client without it
// is somebody's hand-written resource and is never touched.
export const DISCOVERED_BY_LABEL = 'codemowers.cloud/discovered-from'

const list = (value) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean)

const annotationsOf = (ingress) => ingress?.metadata?.annotations ?? {}

// Any codemowers.io/oidc-* annotation asks for discovery. Keying off the whole
// prefix rather than one required annotation means a typo still gets a
// complaint on the resource instead of silently doing nothing.
export const requestsDiscovery = (ingress) =>
    Object.keys(annotationsOf(ingress)).some(key => key.startsWith(ANNOTATION_PREFIX))

// Hosts an Ingress serves, in rule order.
export const hostsOf = (ingress) =>
    (ingress?.spec?.rules ?? []).map(rule => rule.host).filter(Boolean)

// What cannot be turned into a client, phrased for an event on the Ingress.
export const discoveryProblems = (ingress) => {
    const problems = []
    const hosts = hostsOf(ingress)
    if (!hosts.length) {
        problems.push('no host in spec.rules to build a redirect URI from')
    } else if (hosts.length > 1) {
        // One client has one uri; picking a host for the operator would be a
        // guess, and guessing which host an application authenticates on is
        // not a good failure mode.
        problems.push(`${hosts.length} hosts in spec.rules; discovery supports one (${hosts.join(', ')})`)
    }
    if (!list(annotationsOf(ingress)[annotation('redirect-path')]).length) {
        problems.push(`${annotation('redirect-path')} is required`)
    }
    return problems
}

// The OIDCClient spec an annotated Ingress describes. Only the annotations that
// have no sensible default are required; everything else follows the CRD's own
// defaults so the generated resource stays as small as what was asked for.
export const oidcClientSpecFor = (ingress) => {
    const annotations = annotationsOf(ingress)
    const host = hostsOf(ingress)[0]
    const paths = list(annotations[annotation('redirect-path')])
    const spec = {
        displayName: annotations[annotation('display-name')] ?? ingress.metadata.name,
        uri: `https://${host}/`,
        redirectUris: paths.map(path => new URL(path, `https://${host}`).href),
        grantTypes: list(annotations[annotation('grant-types')]).length
            ? list(annotations[annotation('grant-types')])
            : ['authorization_code'],
        responseTypes: list(annotations[annotation('response-types')]).length
            ? list(annotations[annotation('response-types')])
            : ['code'],
        availableScopes: list(annotations[annotation('available-scopes')]).length
            ? list(annotations[annotation('available-scopes')])
            : ['openid'],
    }
    const allowedGroups = list(annotations[annotation('allowed-groups')])
    if (allowedGroups.length) {
        spec.allowedGroups = allowedGroups
    }
    const allowedUsers = list(annotations[annotation('allowed-users')])
    if (allowedUsers.length) {
        spec.allowedUsers = allowedUsers
    }
    return spec
}

export const discoveredClientLabels = (ingress) => ({
    'app.kubernetes.io/managed-by': 'passmower',
    [DISCOVERED_BY_LABEL]: `Ingress.${ingress.metadata.name}`,
})

// Ours to manage only if this exact Ingress produced it. Anything else — a
// hand-written client, or one discovered from a different Ingress that happens
// to share the name — is left alone.
export const isDiscoveredFrom = (client, ingress) =>
    client?.metadata?.labels?.[DISCOVERED_BY_LABEL] === `Ingress.${ingress.metadata.name}`

export const discoveredClientKind = OIDCClientCrd
