// How an application presents itself in a launcher (#53): an icon and a few
// links beside its name and description. Both come from the client resource's
// spec, written by whoever owns the application, so both are checked before
// they reach a page.

const ICON = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i
// The dashboard's CSP only loads images from itself and data: URIs, so an icon
// is inline. Kept small: it is stored with the client and sent in every
// applications listing.
export const MAX_ICON_LENGTH = 16 * 1024
export const MAX_LINKS = 8

// A data: image URI, or undefined for anything else (a remote URL included).
// It is only ever used as an <img> source, where SVG cannot run script.
export const appIcon = (value) =>
    typeof value === 'string' && value.length <= MAX_ICON_LENGTH && ICON.test(value) ? value : undefined

// Named http(s) links, e.g. documentation, issue tracker, status page.
export const appLinks = (value) => {
    if (!Array.isArray(value)) return []
    const links = []
    for (const link of value) {
        const name = typeof link?.name === 'string' ? link.name.trim() : ''
        let url
        try {
            url = new URL(link?.url)
        } catch {
            continue
        }
        if (!name || !['http:', 'https:'].includes(url.protocol)) continue
        links.push({name: name.slice(0, 64), url: url.href})
        if (links.length === MAX_LINKS) break
    }
    return links
}
