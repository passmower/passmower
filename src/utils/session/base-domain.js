import {parseDomain} from "parse-domain";

export const getBaseDomainFromUrl = (url) => {
    url = new URL(url)
    const domain = parseDomain(url.hostname);
    // Non-registrable hosts (IP addresses, "localhost", single labels) have no
    // domain/topLevelDomains. Fall back to the hostname itself so the app still
    // boots in local/dev/test setups instead of throwing at import.
    if (!domain.domain || !domain.topLevelDomains?.length) {
        return url.hostname
    }
    return [
        domain.domain,
        domain.topLevelDomains.join('.')
    ].join('.')
}

export const providerBaseDomain = getBaseDomainFromUrl(process.env.ISSUER_URL)

// The base domain itself or a subdomain of it. A bare suffix match would also
// accept look-alike registrable domains such as "evil" + providerBaseDomain.
export const isHostInProviderBaseDomain = (host, baseDomain = providerBaseDomain) => {
    if (typeof host !== 'string') return false
    host = host.toLowerCase().replace(/\.$/, '')
    baseDomain = baseDomain.toLowerCase()
    return host === baseDomain || host.endsWith('.' + baseDomain)
}

export const getUrlsInProviderBaseDomain = (urls) => {
    return urls.filter(url => isHostInProviderBaseDomain((new URL(url)).hostname))
}
