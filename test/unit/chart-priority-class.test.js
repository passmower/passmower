import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
const values = load(readFileSync(url('values.yaml'), 'utf8'))

// Only the bundled Redis could be given a PriorityClass, leaving Passmower
// itself — which every sign-in depends on — at the cluster default.
describe('the chart wiring for priorityClassName', () => {
    it.each(['templates/deployment.yaml', 'templates/pre-install.yaml'])('threads it into %s', (file) => {
        expect(readFileSync(url(file), 'utf8')).toContain('with .Values.priorityClassName')
    })

    it('leaves it empty by default so an upgrade cannot change preemption', () => {
        expect(values.priorityClassName).toBe('')
    })
})
