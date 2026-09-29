import {describe, expect, it} from 'vitest'
import {secretDataChanged} from '../../src/utils/kubernetes/secret-data-changed.js'

describe('secretDataChanged', () => {
    it('sees no change in data read back the way the adapter decodes it', () => {
        // The adapter JSON-parses what it can and writes empty values as-is.
        expect(secretDataChanged(
            {OIDC_CLIENT_ID: 'apps.grafana', OIDC_CLIENT_URI: '', FLAG: true},
            {OIDC_CLIENT_ID: 'apps.grafana', OIDC_CLIENT_URI: '', FLAG: 'true', ABSENT: undefined},
        )).toBe(false)
    })

    it('sees a changed, added or removed key', () => {
        expect(secretDataChanged({A: 'x'}, {A: 'y'})).toBe(true)
        expect(secretDataChanged({A: 'x'}, {A: 'x', OIDC_IDP_DISPLAY_NAME: 'GitHub'})).toBe(true)
        expect(secretDataChanged({A: 'x', B: 'y'}, {A: 'x'})).toBe(true)
    })
})
