import { describe, expect, it } from 'vitest'
import ejs from 'ejs'
import { fileURLToPath } from 'node:url'

const layoutPath = fileURLToPath(new URL('../../src/views/_layout.ejs', import.meta.url))

describe('page layout', () => {
    it('renders pages that do not define the welcome local', async () => {
        const html = await ejs.renderFile(layoutPath, {
            body: '<p>Message</p>',
            dbg: undefined,
            nonce: 'test-nonce',
            title: 'Message',
            uid: null,
            wide: false,
        })

        expect(html).toContain('<p>Message</p>')
        expect(html).not.toContain('class="welcome-logo"')
    })
})
