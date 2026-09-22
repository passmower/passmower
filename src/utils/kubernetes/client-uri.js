// The application's own URI, projected into its generated Secret so a Deployment
// can point an env var at it instead of repeating the hostname (#268).
//
// Deliberately string work rather than `new URL(uri).href`: URL normalisation
// *adds* a trailing slash to a bare origin, and the consumers that prompted this
// — NEXTAUTH_URL among them — treat a trailing slash as part of the path and
// build broken callback URLs from it.
//
//   new URL('https://app.example.com').href   === 'https://app.example.com/'
//
// A slash the operator wrote themselves is dropped for the same reason: the key
// is only worth having if it can be consumed without further massaging.

const trimTrailingSlashes = (uri) => uri.replace(/\/+$/, '')

// spec.uri is optional, and a client using spec.ingressRef has it resolved in
// memory rather than set, so both of these can legitimately have nothing to
// report. They still emit a key: a Secret key that is sometimes absent breaks
// any Deployment referencing it with secretKeyRef, which blocks the pod from
// starting rather than leaving the value empty.
export const clientUri = (uri) => {
    if (!uri) {
        return ''
    }
    return trimTrailingSlashes(uri.trim())
}

// Scheme, host and port, with no path, query or fragment — what an application
// needs to build its own absolute URLs, and what a CORS allowlist is written in.
export const clientOrigin = (uri) => {
    const normalised = clientUri(uri)
    if (!normalised) {
        return ''
    }
    try {
        const {origin} = new URL(normalised)
        // Opaque origins (a non-special scheme such as a custom app scheme)
        // serialise as "null", which is not a usable value for anything.
        return origin === 'null' ? '' : origin
    } catch {
        return ''
    }
}
