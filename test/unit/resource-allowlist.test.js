import { describe, it, expect } from 'vitest'
import { isResourceAllowed, isResourceIndicator, allowlistRequired } from '../../src/utils/resource-allowlist.js'

const API = 'https://gallery.test/api'

describe('isResourceAllowed', () => {
    it('allows only listed resources when the client has a list', () => {
        const client = { allowedResources: [API] }
        expect(isResourceAllowed(client, API, false)).toBe(true)
        expect(isResourceAllowed(client, 'https://other.test/api', false)).toBe(false)
        // A list wins over the deployment default either way.
        expect(isResourceAllowed(client, API, true)).toBe(true)
    })

    it('treats an empty list as no resources', () => {
        expect(isResourceAllowed({ allowedResources: [] }, API, false)).toBe(false)
    })

    it('lets a client without a list name any resource unless an allowlist is required', () => {
        expect(isResourceAllowed({}, API, false)).toBe(true)
        expect(isResourceAllowed({}, API, true)).toBe(false)
    })
})

describe('allowlistRequired', () => {
    it('reads RESOURCE_ALLOWLIST_REQUIRED', () => {
        expect(allowlistRequired({ RESOURCE_ALLOWLIST_REQUIRED: 'true' })).toBe(true)
        expect(allowlistRequired({ RESOURCE_ALLOWLIST_REQUIRED: 'false' })).toBe(false)
        expect(allowlistRequired({})).toBe(false)
    })
})

describe('isResourceIndicator', () => {
    it('accepts absolute http(s) URIs without a fragment', () => {
        expect(isResourceIndicator(API)).toBe(true)
        expect(isResourceIndicator('http://localhost:8080/mcp')).toBe(true)
    })

    it('rejects fragments, relative and non-string values', () => {
        expect(isResourceIndicator('https://gallery.test/api#x')).toBe(false)
        expect(isResourceIndicator('/api')).toBe(false)
        expect(isResourceIndicator('urn:x')).toBe(false)
        expect(isResourceIndicator(42)).toBe(false)
    })
})
