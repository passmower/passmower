import RedisAdapter from "../../adapters/redis.js";
import {checkAccountGroups} from "../user/check-account-groups.js";
import {renderMarkdown} from "../markdown.js";

// OIDCClient and OIDCMiddlewareClient share the 'Client' redis model and the
// 'Clients' set, so this returns both kinds of launchable apps (anything with a uri).
export const getEnrolledApps = async () => {
    const clientsRedis = new RedisAdapter('Clients')
    const clientRedis = new RedisAdapter('Client')
    const ids = await clientsRedis.getSetMembers(1)
    const clients = await Promise.all(ids.map(id => clientRedis.find(id)))
    return clients.filter(c => c?.uri)
}

const toApp = (client) => ({
    name: client.displayName ?? client.client_name,
    url: client.uri,
    groups: client.allowedGroups ?? [],
    displayOrder: client.displayOrder ?? 0,
    // Rendered from the resource's kubernetes.io/description annotation (Markdown -> safe HTML).
    description: renderMarkdown(client.description),
})

const byDisplayOrderThenName = (a, b) => (a.displayOrder - b.displayOrder) || a.name.localeCompare(b.name)

// Apps the account can access — the `applications` claim / launcher list.
export const listMyApps = async (account) => {
    const clients = await getEnrolledApps()
    return clients
        .filter(c => checkAccountGroups(c, account))
        .map(toApp)
        .sort(byDisplayOrderThenName)
}

// Every enrolled app, each annotated with whether the account can access it —
// the admin-gated catalog / cluster overview.
export const listAllApps = async (account) => {
    const clients = await getEnrolledApps()
    return clients
        .map(c => ({...toApp(c), accessible: checkAccountGroups(c, account)}))
        .sort(byDisplayOrderThenName)
}
