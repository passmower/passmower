import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown.js'

// Guards the marked v18 renderer migration: rendering works AND untrusted input
// is neutralised (links open safely, unsafe schemes and raw HTML are defused).
describe('renderMarkdown', () => {
    it('renders basic markdown', () => {
        expect(renderMarkdown('# Hi')).toContain('<h1>Hi</h1>')
        expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    })

    it('returns null for empty input', () => {
        expect(renderMarkdown('')).toBeNull()
        expect(renderMarkdown(null)).toBeNull()
    })

    it('opens links in a new tab and keeps safe hrefs', () => {
        const html = renderMarkdown('[ok](https://example.com)')
        expect(html).toContain('href="https://example.com"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noreferrer noopener"')
    })

    it('neutralises javascript: links to #', () => {
        const html = renderMarkdown('[bad](javascript:alert(1))')
        expect(html).toContain('href="#"')
        expect(html).not.toContain('javascript:')
    })

    it('escapes raw embedded HTML', () => {
        const html = renderMarkdown('text <img src=x onerror=alert(1)>')
        expect(html).not.toContain('<img')
        expect(html).toContain('&lt;img')
    })
})
