import {parseDomain} from "parse-domain";
import microMatch from "micromatch";

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

export const isHostInProviderBaseDomain = (host) => {
    return microMatch.isMatch(host, '*' + providerBaseDomain)
}

export const getUrlsInProviderBaseDomain = (urls) => {
    return urls.filter(url => isHostInProviderBaseDomain((new URL(url)).hostname))
}
