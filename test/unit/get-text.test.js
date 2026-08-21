import {beforeEach, describe, expect, it, vi} from 'vitest'

const fs = vi.hoisted(() => ({existsSync: vi.fn(), readFileSync: vi.fn()}))

vi.mock('fs', () => fs)

import {getTermsOfService} from '../../src/utils/get-text.js'
import {getTermsOfServiceDocument} from '../../src/utils/user/tos-required.js'

beforeEach(() => {
    fs.existsSync.mockReset().mockImplementation(path => path.endsWith('/tos.md'))
    fs.readFileSync.mockReset()
})

describe('Terms of Service configuration', () => {
    it('treats an empty or whitespace-only document as unconfigured', () => {
        fs.readFileSync.mockReturnValue('  \n')

        expect(getTermsOfService()).toBeNull()
        expect(getTermsOfServiceDocument()).toBeNull()
    })

    it('renders and hashes a configured document', () => {
        fs.readFileSync.mockReturnValue('# Terms')

        const document = getTermsOfServiceDocument()
        expect(document.text).toContain('<h1>Terms</h1>')
        expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/)
    })
})
