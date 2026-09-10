import {hostsOf} from './ingress-oidc-client.js'

// spec.ingressRef lets a hand-written OIDCClient take its host from an Ingress
// rather than repeat it (#35). Resolution is pure and the result is applied in
// memory: uri and redirectUris are never written back into spec, so the
// resource stays exactly as its author — usually Git — wrote it.
//
// Same namespace only, enforced by the CRD having no namespace field: pointing
// at another namespace's Ingress would let a client claim a hostname it does
// not own.
export const resolveIngressRef = (ingress, redirectPaths = []) => {
    if (!ingress) {
        return {problems: ['the referenced Ingress does not exist']}
    }
    const hosts = hostsOf(ingress)
    if (!hosts.length) {
        return {problems: ['the referenced Ingress has no host in spec.rules']}
    }
    if (hosts.length > 1) {
        // Same reason discovery refuses it: which host an application
        // authenticates on is not a good thing to guess at.
        return {problems: [`the referenced Ingress has ${hosts.length} hosts (${hosts.join(', ')})`]}
    }
    if (!redirectPaths.length) {
        return {problems: ['spec.redirectPaths is empty, so no redirect URI can be built']}
    }
    const host = hosts[0]
    return {
        uri: `https://${host}/`,
        redirectUris: redirectPaths.map(path => new URL(path, `https://${host}`).href),
    }
}
