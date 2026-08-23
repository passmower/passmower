import Koa from 'koa';
import request from 'supertest';
import {beforeEach, describe, expect, it} from 'vitest';
import scimRoutes from '../../src/routes/scimRoutes.js';
import {KubeOIDCUserService} from '../../src/services/kube-oidc-user-service.js';
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js';
import {hashScimToken} from '../../src/services/scim-connection-service.js';
import ScimLinkService from '../../src/services/scim-link-service.js';

const TOKEN = 'test-scim-token-with-enough-entropy';
const BETA_TOKEN = 'another-independent-scim-secret';
const BASE = '/scim/v2/acme';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

describe('SCIM 2.0 provisioning', () => {
    let adapter;
    let callback;
    let userService;

    beforeEach(() => {
        adapter = new FakeKubernetesAdapter();
        adapter.seed('SCIMConnection', {
            metadata: {name: 'acme', uid: 'connection-acme'},
            spec: {
                group: {prefix: 'codemowers', name: 'org-acme'},
                grantMode: 'all-users',
                tokenHashes: [hashScimToken(TOKEN)],
            },
        });
        userService = new KubeOIDCUserService(adapter);
        const app = new Koa();
        app.use(scimRoutes({userService}).routes());
        callback = app.callback();
    });

    const authorized = () => request(callback).get(`${BASE}/ServiceProviderConfig`).set('Authorization', `Bearer ${TOKEN}`);

    function createUser(overrides = {}) {
        return request(callback)
            .post(`${BASE}/Users`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
                externalId: 'entra-user-1',
                userName: 'alice@example.com',
                displayName: 'Alice Example',
                active: true,
                emails: [{value: 'alice@example.com', primary: true}],
                ...overrides,
            });
    }

    function createGroup(overrides = {}) {
        return request(callback)
            .post(`${BASE}/Groups`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                externalId: 'entra-group-1',
                displayName: 'Platform users',
                ...overrides,
            });
    }

    it('requires the configured bearer token', async () => {
        await request(callback).get(`${BASE}/ServiceProviderConfig`).expect(401).expect('WWW-Authenticate', 'Bearer');
        await request(callback).get('/scim/v2/missing/ServiceProviderConfig').set('Authorization', `Bearer ${TOKEN}`).expect(401);
        await authorized().expect(200).expect('Content-Type', /application\/scim\+json/);
    });

    it('supports overlap rotation and rejects every token as soon as the connection is disabled', async () => {
        const nextToken = 'rotated-scim-token-with-enough-entropy';
        adapter.seed('SCIMConnection', {
            metadata: {name: 'acme', uid: 'connection-acme'},
            spec: {
                group: {prefix: 'codemowers', name: 'org-acme'},
                grantMode: 'all-users',
                tokenHashes: [hashScimToken(TOKEN), hashScimToken(nextToken)],
            },
        });
        await authorized().expect(200);
        await request(callback).get(`${BASE}/ServiceProviderConfig`).set('Authorization', `Bearer ${nextToken}`).expect(200);

        const disabled = adapter.list('SCIMConnection')[0];
        disabled.spec.disabled = true;
        adapter.seed('SCIMConnection', disabled);
        await authorized().expect(401);
        await request(callback).get(`${BASE}/ServiceProviderConfig`).set('Authorization', `Bearer ${nextToken}`).expect(401);
    });

    it('creates and filters users idempotently', async () => {
        const created = await createUser().expect(201);
        expect(created.body.id).toMatch(/^scim-u-/);
        expect(created.body.active).toBe(true);
        expect(created.headers.location).toBe(`${BASE}/Users/${created.body.id}`);

        const list = await request(callback)
            .get(`${BASE}/Users`)
            .query({filter: 'userName eq "alice@example.com"'})
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(200);
        expect(list.body.totalResults).toBe(1);
        expect(list.body.Resources[0].externalId).toBe('entra-user-1');

        const countOnly = await request(callback)
            .get(`${BASE}/Users`)
            .query({filter: 'username eq "alice@example.com"', count: 0})
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(200);
        expect(countOnly.body.totalResults).toBe(1);
        expect(countOnly.body.itemsPerPage).toBe(0);
        expect(countOnly.body.Resources).toEqual([]);

        const duplicate = await createUser().expect(409);
        expect(duplicate.body.scimType).toBe('uniqueness');
    });

    it('tracks source memberships without creating login-capable OIDC users', async () => {
        const user = (await createUser().expect(201)).body;
        const group = (await createGroup().expect(201)).body;

        await request(callback)
            .patch(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({schemas: [PATCH_SCHEMA], Operations: [{op: 'Add', path: 'members', value: [{value: user.id}]}]})
            .expect(200);

        let stored = adapter.list('SCIMSubject').find(item => item.metadata.name === user.id);
        expect(stored.spec.identity.groups).toEqual([{prefix: 'codemowers', name: 'org-acme'}]);
        expect(stored.spec.identity.sourceGroups).toEqual([group.id]);
        expect(adapter.list('OIDCUser')).toEqual([]);
        await request(callback)
            .patch(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({schemas: [PATCH_SCHEMA], Operations: [{op: 'Remove', path: `members[value eq "${user.id}"]`}]})
            .expect(200);

        stored = adapter.list('SCIMSubject').find(item => item.metadata.name === user.id);
        expect(stored.spec.identity.sourceGroups).toEqual([]);
        expect(stored.spec.identity.groups).toEqual([{prefix: 'codemowers', name: 'org-acme'}]);
    });

    it('deactivates instead of deleting a user and removes SCIM groups from token status', async () => {
        const user = (await createUser().expect(201)).body;
        const group = (await createGroup({members: [{value: user.id}]}).expect(201)).body;
        expect(group.members).toHaveLength(1);

        await request(callback)
            .delete(`${BASE}/Users/${user.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(204);

        const stored = adapter.list('SCIMSubject').find(item => item.metadata.name === user.id);
        expect(stored.spec.identity.active).toBe(false);
        expect(stored.spec.identity.groups).toEqual([]);
        expect(adapter.list('OIDCUser')).toEqual([]);

        const fetched = await request(callback)
            .get(`${BASE}/Users/${user.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(200);
        expect(fetched.body.active).toBe(false);
    });

    it('reactivates a deleted group when it is provisioned again', async () => {
        const user = (await createUser().expect(201)).body;
        const group = (await createGroup({members: [{value: user.id}]}).expect(201)).body;

        await request(callback)
            .delete(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(204);
        await request(callback)
            .get(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(404);

        const recreated = await createGroup({members: [{value: user.id}]}).expect(201);
        expect(recreated.body.id).toBe(group.id);
        expect(recreated.body.members.map(member => member.value)).toEqual([user.id]);

        const list = await request(callback)
            .get(`${BASE}/Groups`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(200);
        expect(list.body.totalResults).toBe(1);
    });

    it('maps emails sub-attribute PATCH paths onto the stored address', async () => {
        const user = (await createUser().expect(201)).body;
        const patched = await request(callback)
            .patch(`${BASE}/Users/${user.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({schemas: [PATCH_SCHEMA], Operations: [{op: 'Replace', path: 'emails[type eq "work"].value', value: 'alice@corp.example.com'}]})
            .expect(200);
        expect(patched.body.emails).toEqual([{value: 'alice@corp.example.com', primary: true}]);
    });

    it('accepts a no-path group PATCH that only carries members', async () => {
        const user = (await createUser().expect(201)).body;
        const group = (await createGroup().expect(201)).body;
        const patched = await request(callback)
            .patch(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({schemas: [PATCH_SCHEMA], Operations: [{op: 'Replace', value: {members: [{value: user.id}]}}]})
            .expect(200);
        expect(patched.body.members.map(member => member.value)).toEqual([user.id]);
    });

    it('rejects unsupported filters and unknown group members with SCIM errors', async () => {
        const user = (await createUser().expect(201)).body;
        const group = (await createGroup().expect(201)).body;
        await request(callback)
            .get(`${BASE}/Users`)
            .query({filter: 'userName co "alice"'})
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(400)
            .expect(response => expect(response.body.scimType).toBe('invalidFilter'));

        await request(callback)
            .patch(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .send({schemas: [PATCH_SCHEMA], Operations: [{op: 'Add', path: 'members', value: [{value: user.id}, {value: 'missing'}]}]})
            .expect(400)
            .expect(response => expect(response.body.scimType).toBe('invalidValue'));

        const fetched = await request(callback)
            .get(`${BASE}/Groups/${group.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(200);
        expect(fetched.body.members).toEqual([]);
    });

    it('isolates credentials, external IDs, resources, and projected groups by connection', async () => {
        adapter.seed('SCIMConnection', {
            metadata: {name: 'beta', uid: 'connection-beta'},
            spec: {
                group: {prefix: 'codemowers', name: 'org-beta'},
                grantMode: 'all-users',
                tokenHashes: [hashScimToken(BETA_TOKEN)],
            },
        });

        const acme = (await createUser().expect(201)).body;
        const beta = await request(callback)
            .post('/scim/v2/beta/Users')
            .set('Authorization', `Bearer ${BETA_TOKEN}`)
            .send({externalId: 'entra-user-1', userName: 'alice@example.com', active: true})
            .expect(201);

        expect(beta.body.id).not.toBe(acme.id);
        await request(callback).get('/scim/v2/beta/Users').set('Authorization', `Bearer ${TOKEN}`).expect(401);

        const acmeList = await request(callback).get(`${BASE}/Users`).set('Authorization', `Bearer ${TOKEN}`).expect(200);
        const betaList = await request(callback).get('/scim/v2/beta/Users').set('Authorization', `Bearer ${BETA_TOKEN}`).expect(200);
        expect(acmeList.body.Resources.map(user => user.id)).toEqual([acme.id]);
        expect(betaList.body.Resources.map(user => user.id)).toEqual([beta.body.id]);

        const storedAcme = adapter.list('SCIMSubject').find(item => item.metadata.name === acme.id);
        const storedBeta = adapter.list('SCIMSubject').find(item => item.metadata.name === beta.body.id);
        expect(storedAcme.spec.identity.groups).toEqual([{prefix: 'codemowers', name: 'org-acme'}]);
        expect(storedBeta.spec.identity.groups).toEqual([{prefix: 'codemowers', name: 'org-beta'}]);
        expect(adapter.list('OIDCUser')).toEqual([]);
    });

    it('links and projects only after verified provider, tenant, and subject claims match', async () => {
        adapter.seed('SCIMConnection', {
            metadata: {name: 'acme', uid: 'connection-acme'},
            spec: {
                group: {prefix: 'codemowers', name: 'org-acme'},
                grantMode: 'all-users',
                tokenHashes: [hashScimToken(TOKEN)],
                linking: {provider: 'entra', tenantClaim: 'tid', tenantValue: 'tenant-acme', subjectClaim: 'oid'},
            },
        });
        adapter.seed('OIDCUser', {
            metadata: {name: 'alice'},
            spec: {type: 'person'},
            identities: {entra: {sub: 'pairwise-sub', linkClaims: {tid: 'tenant-acme', oid: 'entra-user-1'}}},
        });
        const subject = (await createUser().expect(201)).body;
        const linker = new ScimLinkService(adapter, userService);

        expect(await linker.linkAccount('entra', 'alice', {tid: 'another-tenant', oid: 'entra-user-1'})).toEqual([]);
        expect(adapter.list('SCIMSubject')[0].status.accountId).toBeUndefined();

        expect(await linker.linkAccount('entra', 'alice', {tid: 'tenant-acme', oid: 'entra-user-1'})).toEqual([subject.id]);
        expect(adapter.list('SCIMSubject')[0].status.accountId).toBe('alice');
        let account = adapter.list('OIDCUser').find(item => item.metadata.name === 'alice');
        expect(account.identities['scim-connection-acme'].groups).toEqual([{prefix: 'codemowers', name: 'org-acme'}]);
        expect(account.status.groups).toEqual([{prefix: 'codemowers', name: 'org-acme'}]);

        await request(callback)
            .delete(`${BASE}/Users/${subject.id}`)
            .set('Authorization', `Bearer ${TOKEN}`)
            .expect(204);
        account = adapter.list('OIDCUser').find(item => item.metadata.name === 'alice');
        expect(account.identities['scim-connection-acme'].active).toBe(false);
        expect(account.status.groups).toEqual([]);
    });
});
