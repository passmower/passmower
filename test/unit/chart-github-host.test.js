import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {load, loadAll} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const chart = new URL('../../charts/passmower/', import.meta.url).pathname

describe('GitHub host chart configuration', () => {
    // Renders the chart twice with `helm template`; a loaded CI runner overruns
    // the 5 s default, so the timeout is raised.
    it('preserves the default and exposes enterprise hosts to the connector', () => {
        const values = load(readFileSync(`${chart}values.yaml`, 'utf8'))
        expect(values.passmower.githubHost).toBe('github.com')
        for (const host of ['github.com', 'example.ghe.com']) {
            const docs = loadAll(execFileSync('helm', ['template', 'test', chart,
                '--set', 'passmower.host=auth.example.com', '--set', `passmower.githubHost=${host}`,
            ], {encoding: 'utf8'}))
            const deployment = docs.find(doc => doc?.kind === 'Deployment')
            expect(deployment.spec.template.spec.containers[0].env)
                .toContainEqual({name: 'GITHUB_HOST', value: host})
            const crd = docs.find(doc => doc?.kind === 'CustomResourceDefinition'
                && doc.metadata.name === 'oidcusers.codemowers.cloud')
            for (const version of crd.spec.versions) {
                const github = version.schema.openAPIV3Schema.properties.github
                expect(github.properties.host.type).toBe('string')
                expect(github.properties.groups.items.properties.prefix.enum).toBeUndefined()
            }
        }
    }, 30_000)
})
