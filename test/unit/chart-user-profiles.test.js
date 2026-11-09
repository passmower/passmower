import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const read = (path) => readFileSync(new URL(`../../charts/passmower/${path}`, import.meta.url), 'utf8')

// User profile pages (#318) publish names and emails to every signed-in user.
describe('user profiles chart values', () => {
    it('ships disabled and threads the env var', () => {
        expect(load(read('values.yaml')).passmower.userProfiles).toEqual({enabled: false})
        expect(read('templates/deployment.yaml')).toContain('- name: USER_PROFILES_ENABLED')
    })
})
