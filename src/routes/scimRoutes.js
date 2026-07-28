import Router from '@koa/router';
import {koaBody} from 'koa-body';
import ScimService, {ScimError} from '../services/scim-service.js';
import ScimConnectionService from '../services/scim-connection-service.js';
import ScimDirectoryService from '../services/scim-directory-service.js';
import ScimLinkService from '../services/scim-link-service.js';

const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

function bearerToken(ctx) {
    const authorization = ctx.get('authorization');
    return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
}

function scimError(error) {
    const known = error instanceof ScimError;
    return {
        status: known ? error.status : 500,
        body: {
            schemas: [SCIM_ERROR_SCHEMA],
            status: String(known ? error.status : 500),
            detail: known ? error.message : 'Internal server error',
            ...(known && error.scimType ? {scimType: error.scimType} : {}),
        },
    };
}

function parseFilter(filter) {
    if (!filter) return [];
    const clauses = String(filter).split(/\s+and\s+/i);
    return clauses.map(clause => {
        const match = clause.match(/^([\w.]+)\s+eq\s+"([^"]*)"$/i);
        if (!match) throw new ScimError(400, `Unsupported filter ${filter}`, 'invalidFilter');
        return {attribute: match[1], value: match[2]};
    });
}

function matches(resource, clauses) {
    const attributes = {
        username: 'userName',
        externalid: 'externalId',
        displayname: 'displayName',
        id: 'id',
    };
    return clauses.every(({attribute, value}) => String(resource[attributes[attribute.toLowerCase()] ?? attribute] ?? '') === value);
}

function listResponse(resources, query) {
    const parsedStart = Number.parseInt(query.startIndex ?? '1', 10);
    const parsedCount = Number.parseInt(query.count ?? '100', 10);
    const startIndex = Math.max(1, Number.isNaN(parsedStart) ? 1 : parsedStart);
    const count = Math.max(0, Math.min(100, Number.isNaN(parsedCount) ? 100 : parsedCount));
    return {
        schemas: [LIST_SCHEMA],
        totalResults: resources.length,
        startIndex,
        itemsPerPage: Math.min(count, Math.max(0, resources.length - startIndex + 1)),
        Resources: resources.slice(startIndex - 1, startIndex - 1 + count),
    };
}

export default function scimRoutes({userService, connectionService, directoryServiceFactory} = {}) {
    const router = new Router({prefix: '/scim/v2/:connectionId'});

    router.use(async (ctx, next) => {
        ctx.type = 'application/scim+json';
        const accountUsers = userService ?? ctx.kubeOIDCUserService;
        const connections = connectionService ?? new ScimConnectionService(accountUsers.adapter);
        let connection;
        try {
            connection = await connections.find(ctx.params.connectionId);
        } catch (error) {
            // Do not reveal whether a connection id exists to unauthenticated
            // callers. Both a missing connection and a bad token are 401.
            if (error instanceof ScimError && error.status === 404) connection = null;
            else throw error;
        }
        if (!connection || !connections.authenticate(connection, bearerToken(ctx))) {
            ctx.status = 401;
            ctx.set('WWW-Authenticate', 'Bearer');
            ctx.body = {schemas: [SCIM_ERROR_SCHEMA], status: '401', detail: 'Invalid bearer token'};
            return;
        }
        ctx.scimConnection = connection;
        const linker = new ScimLinkService(accountUsers.adapter, accountUsers);
        ctx.scimUserService = directoryServiceFactory
            ? directoryServiceFactory(connection)
            : new ScimDirectoryService(accountUsers.adapter, connection, {
                onChange: subject => linker.project(connection, subject),
            });
        try {
            await next();
        } catch (error) {
            const response = scimError(error);
            ctx.status = response.status;
            ctx.body = response.body;
            if (!(error instanceof ScimError)) globalThis.logger?.error({error}, 'SCIM request failed');
        }
    });

    // Authenticate before reading request bodies. Apart from avoiding needless
    // parsing work for rejected callers, this keeps the unauthenticated attack
    // surface independent of SCIM payload complexity.
    router.use(koaBody({json: true, jsonLimit: '1mb'}));

    const service = ctx => new ScimService(ctx.scimUserService, ctx.scimConnection);
    const baseUrl = ctx => `/scim/v2/${ctx.scimConnection.id}`;

    router.get('/ServiceProviderConfig', ctx => {
        ctx.body = {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
            patch: {supported: true},
            bulk: {supported: false, maxOperations: 0, maxPayloadSize: 0},
            filter: {supported: true, maxResults: 100},
            changePassword: {supported: false},
            sort: {supported: false},
            // ETag headers are emitted for information, but conditional
            // requests (If-Match / If-None-Match) are not honored yet.
            etag: {supported: false},
            authenticationSchemes: [{
                type: 'oauthbearertoken',
                name: 'Bearer token',
                description: 'Connection-scoped bearer token',
                specUri: 'https://www.rfc-editor.org/info/rfc6750',
                primary: true,
            }],
            meta: {resourceType: 'ServiceProviderConfig', location: `${baseUrl(ctx)}/ServiceProviderConfig`},
        };
    });

    router.get('/ResourceTypes', ctx => {
        ctx.body = listResponse(['User', 'Group'].map(name => ({
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: name,
            name,
            endpoint: `/${name}s`,
            schema: `urn:ietf:params:scim:schemas:core:2.0:${name}`,
        })), ctx.query);
    });

    router.get('/Schemas', ctx => {
        ctx.body = listResponse(['User', 'Group'].map(name => ({
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
            id: `urn:ietf:params:scim:schemas:core:2.0:${name}`,
            name,
            description: `SCIM core ${name} schema`,
            attributes: [],
        })), ctx.query);
    });

    router.get('/Users', async ctx => {
        const svc = service(ctx);
        const filter = parseFilter(ctx.query.filter);
        const resources = (await svc.listUsers()).map(account => svc.userResource(account));
        ctx.body = listResponse(resources.filter(resource => matches(resource, filter)), ctx.query);
    });

    router.post('/Users', async ctx => {
        ctx.status = 201;
        ctx.body = await service(ctx).createUser(ctx.request.body);
        ctx.set('Location', ctx.body.meta.location);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.get('/Users/:id', async ctx => {
        const svc = service(ctx);
        ctx.body = svc.userResource(await svc.findUser(ctx.params.id));
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.put('/Users/:id', async ctx => {
        ctx.body = await service(ctx).replaceUser(ctx.params.id, ctx.request.body);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.patch('/Users/:id', async ctx => {
        if (!ctx.request.body?.schemas?.includes(PATCH_SCHEMA)) {
            throw new ScimError(400, 'PATCH schema is required', 'invalidSyntax');
        }
        ctx.body = await service(ctx).patchUser(ctx.params.id, ctx.request.body.Operations);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.delete('/Users/:id', async ctx => {
        await service(ctx).deactivateUser(ctx.params.id);
        ctx.status = 204;
    });

    router.get('/Groups', async ctx => {
        const svc = service(ctx);
        const filter = parseFilter(ctx.query.filter);
        const [groups, users] = await Promise.all([svc.listGroups(), svc.listUsers()]);
        const resources = await Promise.all(groups.map(account => svc.groupResource(account, users)));
        ctx.body = listResponse(resources.filter(resource => matches(resource, filter)), ctx.query);
    });

    router.post('/Groups', async ctx => {
        ctx.status = 201;
        ctx.body = await service(ctx).createGroup(ctx.request.body);
        ctx.set('Location', ctx.body.meta.location);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.get('/Groups/:id', async ctx => {
        const svc = service(ctx);
        ctx.body = await svc.groupResource(await svc.findGroup(ctx.params.id));
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.put('/Groups/:id', async ctx => {
        ctx.body = await service(ctx).replaceGroup(ctx.params.id, ctx.request.body);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.patch('/Groups/:id', async ctx => {
        if (!ctx.request.body?.schemas?.includes(PATCH_SCHEMA)) {
            throw new ScimError(400, 'PATCH schema is required', 'invalidSyntax');
        }
        ctx.body = await service(ctx).patchGroup(ctx.params.id, ctx.request.body.Operations);
        ctx.set('ETag', ctx.body.meta.version);
    });

    router.delete('/Groups/:id', async ctx => {
        await service(ctx).deleteGroup(ctx.params.id);
        ctx.status = 204;
    });

    return router;
}
