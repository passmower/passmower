import parseurl from 'parseurl';
import kebabCase from "./kebab-case.js";
import {parseRequestMetadata} from "./parse-request-headers.js";
import dns from "dns";
import {Counter} from "prom-client";

export const userinfoError = 'userinfoError'
export const tokenError = 'tokenError'
export const nonExistentClientError = 'nonExistentClientError'
export const invalidClientError = 'invalidClientError'

export const clientNotFound = 'client not found'; // There's no such constant in oidc-provider to import.

export const setupOidcMetrics = () => {
    globalThis.metrics[nonExistentClientError] = new Counter({
        name: 'passmower_non_existent_client_request_count',
        help: 'Number of invalid authentication requests with non-existent Client ID',
        labelNames: [
            'in_cluster',
        ]
    });
    globalThis.metrics[invalidClientError] = new Counter({
        name: 'passmower_invalid_client_request_count',
        help: 'Number of invalid authentication requests',
        labelNames: [
            'client_id',
            'reason',
            'in_cluster',
        ]
    });
    globalThis.metrics[userinfoError] = new Counter({
        name: 'passmower_invalid_userinfo_request_count',
        help: 'Number of invalid userinfo endpoint requests',
        labelNames: [
            'reason',
            'in_cluster',
        ]
    });
    globalThis.metrics[tokenError] = new Counter({
        name: 'passmower_invalid_token_request_count',
        help: 'Number of invalid token endpoint requests',
        labelNames: [
            // 'client_id', Client is not always available
            'reason',
            'in_cluster',
        ]
    });
}

const normalizeReason = (reason) => {
    reason = reason.replaceAll('\'', '').replaceAll('"', '').replaceAll('`', '').replaceAll('/', '')
    return kebabCase(reason)
}

async function reverseLookupPromise(ip) {
    return new Promise((resolve, reject) => {
        dns.reverse(ip, (err, address, family) => {
            if(err) reject(err);
            resolve(address);
        });
    });
};


const inCluster = async (ctx) => {
    const metadata = parseRequestMetadata(ctx.request.headers)
    const rDns = await reverseLookupPromise(metadata.ip)
    return rDns[0]?.endsWith('svc.cluster.local') || false
}

export default (ctx, error, context) => {
    let urlParams = new URLSearchParams()
    try {
        const authUrl = parseurl(ctx.req)
        urlParams = new URLSearchParams(authUrl.query);
    } catch (e) {
        globalThis.logger.error(e)
    }
    (inCluster(ctx)).then(inCluster => {
        let params = {
            client_id: urlParams.get('client_id') || ctx?.oidc?.entities?.Client?.clientId,
            reason: normalizeReason(error?.error_detail || error?.error_description),
            in_cluster: inCluster,
        }
        params = Object.fromEntries(Object.entries(params).filter(([key]) => globalThis.metrics[context]?.labelNames.includes(key)));
        params = Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null)) // Nice one-liner to filter out undefined fields, such as client_id.
        globalThis.metrics[context].inc(params)
    })
}
