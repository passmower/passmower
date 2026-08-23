import {afterEach, describe, expect, it, vi} from 'vitest'
import handleOidcFlowMetrics from '../../src/utils/session/handle-oidc-flow-metrics.js'

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('OIDC flow metrics', () => {
    it('does not create an unhandled rejection when metrics are not initialized', () => {
        vi.stubGlobal('metrics', undefined)
        expect(() => handleOidcFlowMetrics({req: {}, request: {headers: {}}}, {
            error_description: 'refresh token invalid',
        }, 'tokenError')).not.toThrow()
    })
})
