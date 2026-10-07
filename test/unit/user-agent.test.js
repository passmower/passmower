import { describe, it, expect } from 'vitest'
import { parseUserAgent } from '../../src/utils/session/user-agent.js'
import { parseRequestMetadata } from '../../src/utils/session/parse-request-headers.js'

const UA = {
    chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    operaMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
    firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}

describe('parseUserAgent', () => {
    it.each([
        ['chromeWindows', 'Chrome', 'Windows 10'],
        ['edgeWindows', 'Edge', 'Windows 10'],
        ['operaMac', 'Opera', 'macOS 10.15.7'],
        ['firefoxLinux', 'Firefox', 'Linux'],
        ['firefoxMac', 'Firefox', 'macOS 10.15'],
        ['safariMac', 'Safari', 'macOS 10.15.7'],
        ['safariIphone', 'Safari', 'iOS 18.6'],
        ['chromeIphone', 'Chrome', 'iOS 18.6'],
        ['chromeAndroid', 'Chrome', 'Android 10'],
        ['samsungAndroid', 'Samsung Internet', 'Android 14'],
        ['chromeOs', 'Chrome', 'Chrome OS'],
    ])('reads %s from the User-Agent string', (key, browser, os) => {
        expect(parseUserAgent({'user-agent': UA[key]})).toEqual({browser, os})
    })

    it('prefers the product brand from client hints over GREASE and Chromium', () => {
        expect(parseUserAgent({
            'user-agent': UA.chromeWindows,
            'sec-ch-ua': '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        }).browser).toBe('Edge')
        expect(parseUserAgent({
            'sec-ch-ua': '"Not)A;Brand";v="99", "Chromium";v="141"',
        }).browser).toBe('Chromium')
    })

    it('maps the Windows platform version hint to the marketing version', () => {
        const headers = {'user-agent': UA.chromeWindows, 'sec-ch-ua-platform': '"Windows"'}
        expect(parseUserAgent({...headers, 'sec-ch-ua-platform-version': '"19.0.0"'}).os).toBe('Windows 11')
        expect(parseUserAgent({...headers, 'sec-ch-ua-platform-version': '"10.0.0"'}).os).toBe('Windows 10')
        expect(parseUserAgent(headers).os).toBe('Windows 10')
    })

    it('takes the platform hint over a frozen User-Agent string', () => {
        expect(parseUserAgent({
            'user-agent': UA.chromeAndroid,
            'sec-ch-ua-platform': '"Android"',
            'sec-ch-ua-platform-version': '"15.0.0"',
        }).os).toBe('Android 15.0.0')
    })

    it('leaves unknown clients undefined rather than "undefined"', () => {
        expect(parseUserAgent({'user-agent': 'curl/8.9.1'})).toEqual({browser: undefined, os: undefined})
        expect(parseUserAgent({})).toEqual({browser: undefined, os: undefined})
        expect(parseUserAgent()).toEqual({browser: undefined, os: undefined})
    })
})

describe('parseRequestMetadata', () => {
    it('exposes browser and OS names without the raw parser result', () => {
        const metadata = parseRequestMetadata({'user-agent': UA.firefoxLinux, 'x-forwarded-for': '192.0.2.1'})
        expect(metadata).toMatchObject({browser: 'Firefox', os: 'Linux', ip: '192.0.2.1'})
        expect(metadata).not.toHaveProperty('ua')
    })
})
