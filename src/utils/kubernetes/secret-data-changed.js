// Whether a Secret read back through the adapter holds anything other than
// `desired`. The adapter decodes each value and JSON-parses it where it can,
// and writes an empty or absent value as-is, so compare on the string form.
const asString = (value) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)

export const secretDataChanged = (existing = {}, desired = {}) =>
    [...new Set([...Object.keys(existing), ...Object.keys(desired)])]
        .some(key => asString(existing[key]) !== asString(desired[key]))
