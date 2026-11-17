import {describe, expect, it} from 'vitest'
import {clientResource, incidentFixCommands} from '../../src/utils/session/incident-fix.js'

const denied = {
    source: 'oidc-login',
    accountId: 'eg',
    clientId: 'argocd.argocd',
    failure: 'client_access_required',
    allowedGroups: [],
    allowedUsers: ['alice'],
}

const commands = (incident, options) => incidentFixCommands(incident, options).map((fix) => fix.command)

describe('clientResource', () => {
    it('splits an OIDC client ID at the first dot', () => {
        expect(clientResource('oidc-login', 'apps.grafana.internal'))
            .toEqual({kind: 'OIDCClient', namespace: 'apps', name: 'grafana.internal'})
    })

    it('maps forward auth to the middleware client', () => {
        expect(clientResource('forward-auth', 'middleware-apps.wiki'))
            .toEqual({kind: 'OIDCMiddlewareClient', namespace: 'apps', name: 'wiki'})
    })

    it('keeps a namespace starting with middleware- for OIDC login', () => {
        expect(clientResource('oidc-login', 'middleware-tools.grafana'))
            .toEqual({kind: 'OIDCClient', namespace: 'middleware-tools', name: 'grafana'})
    })

    it('rejects IDs that name no namespaced client', () => {
        expect(clientResource('oidc-login', 'passmower')).toBeNull()
        expect(clientResource('oidc-login', '.grafana')).toBeNull()
        expect(clientResource('oidc-login', 'apps.')).toBeNull()
        expect(clientResource('forward-auth', 'apps.wiki')).toBeNull()
        expect(clientResource('oidc-login', undefined)).toBeNull()
    })
})

describe('incidentFixCommands', () => {
    it('appends the user to an existing allowedUsers list', () => {
        expect(commands(denied)).toEqual([
            `kubectl -n argocd patch oidcclient.codemowers.cloud argocd --type=json -p '[{"op":"add","path":"/spec/allowedUsers/-","value":"eg"}]'`,
        ])
    })

    it('creates allowedUsers when the client has none', () => {
        expect(commands({...denied, allowedUsers: [], allowedGroups: ['github:ops']})).toEqual([
            `kubectl -n argocd patch oidcclient.codemowers.cloud argocd --type=json -p '[{"op":"add","path":"/spec/allowedUsers","value":["eg"]}]'`,
        ])
    })

    it('patches the middleware client for forward auth', () => {
        expect(commands({...denied, source: 'forward-auth', clientId: 'middleware-apps.wiki'})[0])
            .toBe(`kubectl -n apps patch oidcmiddlewareclient.codemowers.cloud wiki --type=json -p '[{"op":"add","path":"/spec/allowedUsers/-","value":"eg"}]'`)
    })

    it('adds local groups to the user, shaped to the existing spec', () => {
        const incident = {...denied, allowedUsers: [], allowedGroups: ['passmower:ops', 'github:ops']}
        const options = {userNamespace: 'passmower', groupPrefix: 'passmower'}
        const groupCommand = (userSpec) => commands(incident, {...options, userSpec})[1]

        expect(commands(incident, {...options, userSpec: {}})).toHaveLength(2)
        expect(groupCommand({groups: [{prefix: 'passmower', name: 'dev'}]}))
            .toBe(`kubectl -n passmower patch oidcuser.codemowers.cloud eg --type=json -p '[{"op":"add","path":"/spec/groups/-","value":{"prefix":"passmower","name":"ops"}}]'`)
        expect(groupCommand({email: 'eg@example.com'}))
            .toBe(`kubectl -n passmower patch oidcuser.codemowers.cloud eg --type=json -p '[{"op":"add","path":"/spec/groups","value":[{"prefix":"passmower","name":"ops"}]}]'`)
        expect(groupCommand(null))
            .toBe(`kubectl -n passmower patch oidcuser.codemowers.cloud eg --type=json -p '[{"op":"add","path":"/spec","value":{"groups":[{"prefix":"passmower","name":"ops"}]}}]'`)
    })

    it('offers no group command without the user namespace', () => {
        expect(commands({...denied, allowedGroups: ['passmower:ops']}, {groupPrefix: 'passmower'})).toHaveLength(1)
    })

    it('quotes a group name the shell would split', () => {
        const [, command] = commands({...denied, allowedGroups: ["passmower:o'neil team"]},
            {userNamespace: 'passmower', groupPrefix: 'passmower', userSpec: {}})
        expect(command).toContain(`-p '[{"op":"add","path":"/spec/groups","value":[{"prefix":"passmower","name":"o'\\''neil team"}]}]'`)
    })

    it('suggests nothing for other failures or anonymous access', () => {
        expect(commands({...denied, failure: 'approval_required'})).toEqual([])
        expect(commands({...denied, accountId: undefined})).toEqual([])
    })
})
