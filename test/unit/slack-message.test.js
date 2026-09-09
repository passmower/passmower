import {describe, expect, it} from 'vitest'
import {escapeMrkdwn, loginLinkMessage} from '../../src/utils/slack-message.js'

const message = (overrides = {}) => loginLinkMessage({
    url: 'https://id.example.com/interaction/abc/verify-email/def',
    instance: 'https://id.example.com/',
    email: 'user@example.com',
    client: 'Grafana',
    browser: 'Firefox on Fedora',
    ip: '198.51.100.7',
    text: 'plain body',
    ...overrides,
})

const blockOfType = (msg, type) => msg.blocks.find(block => block.type === type)

describe('Slack login link message', () => {
    it('carries the link on a button rather than in the body', () => {
        const msg = message()
        const button = blockOfType(msg, 'actions').elements[0]

        expect(button.type).toBe('button')
        expect(button.url).toBe('https://id.example.com/interaction/abc/verify-email/def')
        expect(button.text.text).toBe('Sign in')
        // No action_id: a link button opens the browser and Slack never posts
        // back, so this needs no interactivity endpoint on the IdP.
        expect(button.action_id).toBeUndefined()
    })

    it('always keeps a text fallback for the notification and blocks-less clients', () => {
        expect(message().text).toBe('plain body')
    })

    it('names the client, falling back to the issuer when there is none', () => {
        expect(blockOfType(message(), 'section').text.text)
            .toBe('Sign in to *Grafana* as user@example.com')
        expect(blockOfType(message({client: undefined}), 'section').text.text)
            .toBe('Sign in to *https://id.example.com/* as user@example.com')
    })

    it('escapes mrkdwn in values that come from CRDs', () => {
        const msg = message({client: 'A <b> & C'})

        expect(blockOfType(msg, 'section').text.text).toContain('A &lt;b&gt; &amp; C')
        expect(blockOfType(msg, 'section').text.text).not.toContain('<b>')
    })

    it('reports provenance and drops the parts it does not have', () => {
        const full = blockOfType(message(), 'context').elements.map(e => e.text)
        expect(full).toEqual([
            'Requested from Firefox on Fedora',
            'IP 198.51.100.7',
            "If this wasn't you, ignore this message.",
        ])

        const sparse = blockOfType(message({browser: undefined, ip: undefined}), 'context')
        expect(sparse.elements.map(e => e.text)).toEqual([
            "If this wasn't you, ignore this message.",
        ])
    })

    it('keeps button text inside the 75 character limit Slack enforces', () => {
        // The label is fixed today; the cap is asserted so a future longer one
        // is truncated rather than rejected by Slack at send time.
        const button = blockOfType(message(), 'actions').elements[0]
        expect(button.text.text.length).toBeLessThanOrEqual(75)
    })

    it('escapes only the three characters Slack reserves', () => {
        expect(escapeMrkdwn('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d')
        expect(escapeMrkdwn('*bold* _em_ `code`')).toBe('*bold* _em_ `code`')
        expect(escapeMrkdwn(undefined)).toBe('')
    })
})
