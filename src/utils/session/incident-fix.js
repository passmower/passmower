import {defaultApiGroup, OIDCClientCrd, OIDCMiddlewareClientCrd, OIDCUserCrd} from "../kubernetes/kube-constants.js";

const MIDDLEWARE_PREFIX = 'middleware-'

// Single-quote a value for a POSIX shell, closing and reopening the quote
// around any embedded single quote. Plain Kubernetes names stay bare.
const shellQuote = (value) => /^[A-Za-z0-9._-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`

// Group-qualified, so another operator's oidcclient kind cannot shadow ours.
const jsonPatch = (kind, namespace, name, operations) =>
    `kubectl -n ${shellQuote(namespace)} patch ${kind.toLowerCase()}.${defaultApiGroup} ${shellQuote(name)} --type=json -p ${shellQuote(JSON.stringify(operations))}`

// Client IDs are "<namespace>.<name>", with "middleware-" in front for forward
// auth. A namespace is a DNS label, so the first dot splits them; the name may
// hold further dots. The source decides the kind, because a plain OIDCClient
// can live in a namespace that itself starts with "middleware-".
export const clientResource = (source, clientId) => {
    if (typeof clientId !== 'string') return null
    let kind = OIDCClientCrd
    let id = clientId
    if (source === 'forward-auth') {
        if (!id.startsWith(MIDDLEWARE_PREFIX)) return null
        kind = OIDCMiddlewareClientCrd
        id = id.slice(MIDDLEWARE_PREFIX.length)
    }
    const dot = id.indexOf('.')
    if (dot <= 0 || dot === id.length - 1) return null
    return {kind, namespace: id.slice(0, dot), name: id.slice(dot + 1)}
}

// Ready-to-run kubectl commands that would have let a denied access through
// (#364). JSON patches append to a list that exists and create one that does
// not, since "add" on a missing array index fails and a merge patch would
// replace the whole list.
export const incidentFixCommands = (incident, {userNamespace, groupPrefix, userSpec} = {}) => {
    if (incident?.failure !== 'client_access_required' || !incident.accountId) return []
    const commands = []

    const client = clientResource(incident.source, incident.clientId)
    if (client) {
        const operation = incident.allowedUsers?.length
            ? {op: 'add', path: '/spec/allowedUsers/-', value: incident.accountId}
            : {op: 'add', path: '/spec/allowedUsers', value: [incident.accountId]}
        commands.push({
            description: `Allow ${incident.accountId} on ${client.kind} ${client.namespace}/${client.name}`,
            command: jsonPatch(client.kind, client.namespace, client.name, [operation]),
        })
    }

    // Only local groups can be granted in the cluster; upstream membership
    // comes from GitHub or the OIDC provider on the next login.
    if (userNamespace && groupPrefix) {
        for (const group of incident.allowedGroups ?? []) {
            const [prefix, ...rest] = group.split(':')
            const name = rest.join(':')
            if (prefix !== groupPrefix || !name) continue
            const value = {prefix, name}
            const operation = !userSpec
                ? {op: 'add', path: '/spec', value: {groups: [value]}}
                : userSpec.groups?.length
                    ? {op: 'add', path: '/spec/groups/-', value}
                    : {op: 'add', path: '/spec/groups', value: [value]}
            commands.push({
                description: `Add ${incident.accountId} to group ${group}`,
                command: jsonPatch(OIDCUserCrd, userNamespace, incident.accountId, [operation]),
            })
        }
    }
    return commands
}
