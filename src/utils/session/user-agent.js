// Browser and OS names for display ("Chrome", "Windows 10") from request
// headers. Client hints win where the browser sends them; the User-Agent
// string covers the rest. Only names are derived, never a full device profile.

const BROWSERS = [
    [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
    [/\b(?:OPR|OPiOS)\//, 'Opera'],
    [/\bSamsungBrowser\//, 'Samsung Internet'],
    [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
    [/\b(?:Chrome|CriOS)\//, 'Chrome'],
    [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
]

const BRAND_NAMES = {
    'Google Chrome': 'Chrome',
    'Microsoft Edge': 'Edge',
}

const WINDOWS_NT = {'10.0': '10', '6.3': '8.1', '6.2': '8', '6.1': '7'}

const brands = (header) =>
    [...(header ?? '').matchAll(/"([^"]*)"\s*;\s*v="[^"]*"/g)].map(([, brand]) => brand)

const unquote = (value) => value?.trim().replace(/^"(.*)"$/, '$1') || undefined

const browserFromHints = (headers) => {
    // GREASE entries ("Not)A;Brand") and the Chromium engine brand are noise
    // next to the actual product brand.
    const all = brands(headers['sec-ch-ua']).filter((brand) => !/not.a.brand/i.test(brand))
    const brand = all.find((b) => b !== 'Chromium') ?? all[0]
    return brand && (BRAND_NAMES[brand] ?? brand)
}

const browserFromUserAgent = (ua) => BROWSERS.find(([pattern]) => pattern.test(ua))?.[1]

const osFromUserAgent = (ua) => {
    let m
    if ((m = ua.match(/Windows NT ([\d.]+)/))) return {name: 'Windows', version: WINDOWS_NT[m[1]]}
    if ((m = ua.match(/\b(?:iPhone|iPad|iPod)\b.*? OS ([\d_]+)/))) return {name: 'iOS', version: m[1].replace(/_/g, '.')}
    if ((m = ua.match(/\bAndroid(?: ([\d.]+))?/))) return {name: 'Android', version: m[1]}
    if (/\bCrOS\b/.test(ua)) return {name: 'Chrome OS'}
    if ((m = ua.match(/Mac OS X ([\d_.]+)/))) return {name: 'macOS', version: m[1].replace(/_/g, '.')}
    if (/\bMac OS X\b/.test(ua)) return {name: 'macOS'}
    if (/\bLinux\b/.test(ua)) return {name: 'Linux'}
    return {}
}

const osFromHints = (headers, fromUserAgent) => {
    const name = unquote(headers['sec-ch-ua-platform'])
    if (!name) return fromUserAgent
    let version = unquote(headers['sec-ch-ua-platform-version'])
    // Windows reports its platform version, not its marketing version:
    // 13.0.0 and up is Windows 11, anything lower is Windows 10.
    if (name === 'Windows' && version) version = parseInt(version, 10) >= 13 ? '11' : '10'
    if (!version && fromUserAgent.name === name) version = fromUserAgent.version
    return {name, version}
}

export const parseUserAgent = (headers = {}) => {
    const ua = headers['user-agent'] ?? ''
    const os = osFromHints(headers, osFromUserAgent(ua))
    return {
        browser: browserFromHints(headers) ?? browserFromUserAgent(ua),
        os: os.name && (os.version ? `${os.name} ${os.version}` : os.name),
    }
}
