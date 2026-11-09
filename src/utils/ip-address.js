import {BlockList, isIP} from "node:net";

// An IPv4-mapped IPv6 address (::ffff:192.0.2.1) is the IPv4 address it
// carries; anything that is not an address at all is undefined.
export const normalizeIp = (ip) => {
    const value = ip?.trim()
    if (!value) return undefined
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)
    if (mapped) return mapped[1]
    return isIP(value) ? value.toLowerCase() : undefined
}

const expandIpv6 = (ip) => {
    const [head, tail = ''] = ip.includes('::') ? ip.split('::') : [ip, undefined]
    const left = head ? head.split(':') : []
    const right = tail ? tail.split(':') : []
    // An embedded IPv4 tail (::1.2.3.4) is two groups.
    const last = (right.length ? right : left).at(-1)
    if (last?.includes('.')) {
        const octets = last.split('.').map(Number)
        const groups = [(octets[0] << 8 | octets[1]).toString(16), (octets[2] << 8 | octets[3]).toString(16)]
        ;(right.length ? right : left).splice(-1, 1, ...groups)
    }
    const missing = 8 - left.length - right.length
    return [...left, ...Array(ip.includes('::') ? missing : 0).fill('0'), ...right]
        .map(group => group.padStart(4, '0'))
}

// The unit an unlocked address covers. IPv4 is one address. IPv6 is the /64
// it sits in: a host rotates its privacy address within that prefix (RFC
// 8981), and a /64 is the smallest network a provider assigns to a site.
export const addressKey = (ip) => {
    const address = normalizeIp(ip)
    if (!address) return undefined
    if (isIP(address) === 4) return address
    return `${expandIpv6(address).slice(0, 4).join(':')}::/64`
}

// Parses CIDR ranges and bare addresses separated by commas or whitespace.
// Throws on an entry that is neither, so a typo fails boot instead of quietly
// allowing or refusing traffic.
export const parseRanges = (value) => {
    const list = new BlockList()
    const entries = (value ?? '').split(/[\s,]+/).filter(Boolean)
    for (const entry of entries) {
        const [address, prefix] = entry.split('/')
        const family = isIP(address)
        const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix)
        if (!family || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
            throw new Error(`Invalid address range "${entry}"`)
        }
        list.addSubnet(address, bits, family === 4 ? 'ipv4' : 'ipv6')
    }
    return {list, size: entries.length}
}

export const inRanges = (ranges, ip) => {
    const address = normalizeIp(ip)
    if (!address || !ranges?.size) return false
    return ranges.list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
}
