import {describe, expect, it} from 'vitest'
import {appIcon, appLinks, MAX_ICON_LENGTH, MAX_LINKS} from '../../src/utils/apps/app-presentation.js'
import {toApp} from '../../src/utils/apps/list-apps.js'
import OIDCClient from '../../src/models/oidc-client.js'
import OIDCMiddlewareClient from '../../src/models/oidc-middleware-client.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SVG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'

// Icon and links for the application listing (#53).
describe('application presentation', () => {
    it('accepts inline image icons only', () => {
        expect(appIcon(PNG)).toBe(PNG)
        expect(appIcon(SVG)).toBe(SVG)
        for (const icon of [
            'https://cdn.example.com/icon.png',  // the dashboard loads no remote images
            'data:text/html,<script>alert(1)</script>',
            'javascript:alert(1)',
            'data:image/png' + 'A'.repeat(MAX_ICON_LENGTH),
            '', null, undefined, 42, {},
        ]) {
            expect(appIcon(icon), String(icon).slice(0, 40)).toBeUndefined()
        }
    })

    it('keeps named http(s) links and drops the rest', () => {
        expect(appLinks([
            {name: ' Docs ', url: 'https://docs.example.com/app'},
            {name: 'Status', url: 'http://status.example.com'},
            {name: 'Script', url: 'javascript:alert(1)'},
            {name: 'Data', url: 'data:text/html,x'},
            {name: '', url: 'https://example.com'},
            {url: 'https://example.com'},
            {name: 'Broken', url: 'not a url'},
            null,
        ])).toEqual([
            {name: 'Docs', url: 'https://docs.example.com/app'},
            {name: 'Status', url: 'http://status.example.com/'},
        ])
        expect(appLinks(undefined)).toEqual([])
        expect(appLinks('https://example.com')).toEqual([])
        const many = Array.from({length: 20}, (_, i) => ({name: `l${i}`, url: `https://example.com/${i}`}))
        expect(appLinks(many)).toHaveLength(MAX_LINKS)
    })

    it('is carried from both client kinds into the listing', () => {
        const spec = {
            displayName: 'Grafana',
            uri: 'https://grafana.example.com',
            icon: PNG,
            links: [{name: 'Runbook', url: 'https://wiki.example.com/grafana'}],
        }
        const oidc = new OIDCClient().fromIncomingClient({
            metadata: {name: 'grafana', namespace: 'apps', uid: 'u1'},
            spec: {...spec, redirectUris: ['https://grafana.example.com/cb'], grantTypes: ['authorization_code'], responseTypes: ['code']},
        }).toRedis()
        const middleware = new OIDCMiddlewareClient().fromIncomingClient({
            metadata: {name: 'grafana', namespace: 'apps', uid: 'u2'}, spec,
        }).toRedis()

        for (const client of [oidc, middleware]) {
            expect(toApp(client)).toMatchObject({
                name: 'Grafana',
                icon: PNG,
                links: [{name: 'Runbook', url: 'https://wiki.example.com/grafana'}],
            })
        }
    })

    it('lists an application without either unchanged', () => {
        expect(toApp({displayName: 'Plain', uri: 'https://plain.example.com'}))
            .toMatchObject({icon: undefined, links: []})
        // A stored value that is not acceptable is dropped on the way out.
        expect(toApp({displayName: 'Bad', uri: 'https://x.example.com', icon: 'https://evil.example/i.png'}).icon)
            .toBeUndefined()
    })
})
