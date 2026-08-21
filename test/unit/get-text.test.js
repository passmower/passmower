import {beforeEach, describe, expect, it, vi} from 'vitest'

const fs = vi.hoisted(() => ({existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn()}))

vi.mock('fs', () => fs)

import {clearConfiguredTextCache, getTermsOfService} from '../../src/utils/get-text.js'
import {getTermsOfServiceDocument} from '../../src/utils/user/tos-required.js'

beforeEach(() => {
    clearConfiguredTextCache()
    fs.existsSync.mockReset().mockImplementation(path => path.endsWith('/tos.md'))
    fs.readFileSync.mockReset()
    fs.statSync.mockReset().mockReturnValue({mtimeMs: 1, size: 10})
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

    it('reuses rendered content until the projected file changes', () => {
        fs.readFileSync.mockReturnValue('# Terms')
        expect(getTermsOfService()).toContain('<h1>Terms</h1>')
        expect(getTermsOfService()).toContain('<h1>Terms</h1>')
        expect(fs.readFileSync).toHaveBeenCalledOnce()

        fs.statSync.mockReturnValue({mtimeMs: 2, size: 18})
        fs.readFileSync.mockReturnValue('# Updated terms')
        expect(getTermsOfService()).toContain('Updated terms')
        expect(fs.readFileSync).toHaveBeenCalledTimes(2)
    })
})
