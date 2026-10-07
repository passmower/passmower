import { describe, it, expect, afterEach } from 'vitest'
import { NamespaceFilter } from '../../src/utils/kubernetes/namespace-filter.js'

describe('NamespaceFilter', () => {
    const original = process.env.NAMESPACE_SELECTOR
    afterEach(() => {
        if (original === undefined) delete process.env.NAMESPACE_SELECTOR
        else process.env.NAMESPACE_SELECTOR = original
    })

    const filterFor = (selector) => {
        if (selector === undefined) delete process.env.NAMESPACE_SELECTOR
        else process.env.NAMESPACE_SELECTOR = selector
        return new NamespaceFilter('passmower')
    }

    it('watches only the given namespace for a single literal selector', () => {
        const f = filterFor('apps')
        expect(f.namespace).toBe('apps')
        expect(f.filter('apps')).toBe(true)
        expect(f.filter('apps-dev')).toBe(false)
    })

    it('matches globs across all namespaces', () => {
        const f = filterFor('team-*')
        expect(f.namespace).toBeUndefined()
        expect(f.filter('team-a')).toBe(true)
        expect(f.filter('other')).toBe(false)
        expect(filterFor('*').filter('anything')).toBe(true)
    })

    it('requires every entry of a comma-separated list to match', () => {
        const f = filterFor('*,!kube-*')
        expect(f.namespace).toBeUndefined()
        expect(f.filter('apps')).toBe(true)
        expect(f.filter('kube-system')).toBe(false)
        expect(filterFor('team-*,!team-secret').filter('team-a')).toBe(true)
        expect(filterFor('team-*,!team-secret').filter('team-secret')).toBe(false)
        expect(filterFor('apps,team-*').filter('apps')).toBe(false)
    })

    it('supports negated selectors', () => {
        const f = filterFor('!kube-*')
        expect(f.filter('apps')).toBe(true)
        expect(f.filter('kube-system')).toBe(false)
    })
})
