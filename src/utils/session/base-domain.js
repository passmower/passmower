import {parseDomain} from "parse-domain";
import microMatch from "micromatch";

export const getBaseDomainFromUrl = (url) => {
    url = new URL(url)
    let domain = parseDomain(url.hostname);
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
