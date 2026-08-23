import ShortUniqueId from "short-unique-id";
import {Approved} from "../conditions/approved.js";
import {getSlackId} from "../utils/user/get-slack-id.js";
import {auditLog} from "../utils/session/audit-log.js";
import {listMyApps} from "../utils/apps/list-apps.js";
import {getUsernameSource} from "../utils/username-source.js";
import {sanitizeUsername, isUsernameValid, isUsernameAvailable} from "../utils/user/username.js";
import {fetchExtraClaims} from "../utils/fetch-extra-claims.js";
import {canonicalizeEmail, IdentityIntegrityError} from '../utils/user/identity-integrity.js';
import {getTermsOfServiceDocument} from '../utils/user/tos-required.js';
import {canImpersonateAccount} from '../utils/user/account-type-access.js';

export const AdminGroup = process.env.ADMIN_GROUP;
export const GroupPrefix = process.env.GROUP_PREFIX;

// Stash the upstream identity in the interaction and halt the flow so the user
// can pick a username via the enter-username form.
async function requireCustomUsername(ctx, provider, {email, githubEmails, preferredUsername, identity}) {
    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
    await provider.interactionResult(ctx.req, ctx.res, {
        requireCustomUsername: true,
        email,
        githubEmails,
        preferredUsername,
        stableIdentity: identity,
        ...interactionDetails.result
    }, {
        mergeWithLastSubmission: true,
    })
    auditLog(ctx, {email, githubEmails, preferredUsername}, 'Requiring custom username')
    return undefined
}

class Account {
    #spec = null
    #passmower = null
    #slack = null
    #github = null
    #identities = {}
    #webauthn = null
    #conditions = []
    #termsOfService = null
    #emailVerifications = []
    #labels = {}
    #metadata = {}
    #ctx = null
    #recentApplications = []

    fromKubernetes(apiResponse) {
        this.accountId = apiResponse.metadata.name
        this.#spec = apiResponse.spec
        this.#passmower = apiResponse.passmower
        this.#slack = apiResponse.slack
        this.#github = apiResponse.github
        // Read raw (like the other provider fields) — do NOT default to {}.
        // getSpecs() feeds a JSON-patch diff; synthesizing an empty object here
        // makes the diff emit `add /identities/<key>` against a parent that
        // doesn't exist on the stored object, which the API rejects (422).
        this.#identities = apiResponse.identities
        this.#webauthn = apiResponse.webauthn
        this.resourceVersion = apiResponse.metadata.resourceVersion
        this.primaryEmail = apiResponse.status?.primaryEmail
        this.emails = apiResponse.status?.emails ?? []
        this.groups = apiResponse.status?.groups ?? []
        this.profile = apiResponse.status?.profile ?? {}
        this.slackId = apiResponse.status?.slackId ?? null
        this.#conditions = apiResponse.status?.conditions ?? []
        this.#termsOfService = apiResponse.status?.termsOfService ?? null
        this.#emailVerifications = apiResponse.status?.emailVerifications ?? []
        this.#recentApplications = apiResponse.status?.recentApplications ?? []
        this.#labels = apiResponse.metadata?.labels ?? {}
        this.#metadata = apiResponse.metadata
        this.isAdmin = !!this.#mapGroups().find(g => g.displayName === AdminGroup)
        return this
    }

    setContext(ctx) {
        this.#ctx = ctx;
        return this
    }

    fromRedis(redisObject) {
        Object.assign(this, redisObject)
        this.isAdmin = !!this.#mapGroups().find(g => g.displayName === AdminGroup)
        return this
    }

    /**
     * @param use - can either be "id_token" or "userinfo", depending on
     *   where the specific claims are intended to be put in.
     * @param scope - the intended scope, while oidc-provider will mask
     *   claims depending on the scope automatically you might want to skip
     *   loading some claims from external resources etc. based on this detail
     *   or not return them in id tokens but only userinfo and so on.
     * @param claims {object} - the part of the claims authorization parameter for either
     *   "id_token" or "userinfo" (depends on the "use" param)
     * @param rejected {Array[String]} - claim names that were rejected by the end-user, you might
     *   want to skip loading some claims from external resources or through db projection
     */
    async claims(use, scope, claims, rejected) { // eslint-disable-line no-unused-vars
        const username = this.accountId
        const groups = await Promise.all(this.groups.map(g => g.prefix + ':' + g.name))
        let response = {
            sub: username, // it is essential to always return a sub claim
            username,
            nickname: username,
        };
        if (scope.split(' ').includes('email') && this.primaryEmail) {
            response.email = this.primaryEmail
            response.email_verified = this.isPrimaryEmailVerified()
        }
        if (scope.includes('profile')) {
            response = {
                ...response,
                ...this.profile,
                emails: this.emails,
            };
        }
        if (scope.includes('allowed_groups')) {
            const clientGroups = this.#ctx.oidc.client.allowedGroups || []
            response.groups = clientGroups.length ? groups.filter(g => clientGroups.includes(g)) : clientGroups
        }
        if (scope.includes(' groups')) {
            response.groups = groups
        }
        // Apps the user can access. userinfo only — keeps id_tokens small
        // (conformIdTokenClaims is false, so any claim here would land in the id_token too).
        if (use === 'userinfo' && scope.split(' ').includes('applications')) {
            response.applications = await listMyApps(this)
        }
        // Kubernetes namespaces the caller may access, from the external
        // enrichment webhook. Mirrors the JWT-access-token path in
        // configuration.js so the same claim reaches id_token/userinfo
        // consumers. Fail-open: fetchExtraClaims returns {} on any error.
        if (scope.split(' ').includes('namespaces')) {
            Object.assign(response, await fetchExtraClaims({
                sub: username,
                groups,
                client_id: this.#ctx?.oidc?.client?.clientId,
                scope,
            }))
        }

        return response
    }

    getIntendedStatus(termsOfService = getTermsOfServiceDocument()) {
        const identities = Object.values(this.#identities ?? {})
        const activeIdentities = identities.filter(identity => identity.active !== false)
        const identityEmails = identities.flatMap(i => i.emails ?? [])
        const emails = [...new Set([
            this.#spec?.email,
            this.#spec?.companyEmail,
            this.#passmower?.email,
            ...(this.#github?.emails ?? []).map(ghEmail => ghEmail.email),
            ...identityEmails.map(e => e.email),
        ].map(canonicalizeEmail).filter(Boolean))]
        let primaryEmail
        const preferredDomain = process.env.PREFERRED_EMAIL_DOMAIN
        if (preferredDomain) {
            const emailsWithDomains = emails.map(e => {
                return {
                    email: e,
                    domain: e.split('@')[1]
                }
            })
            primaryEmail = emailsWithDomains.find(e => e.domain === preferredDomain.toLowerCase())
            primaryEmail = primaryEmail?.email
        }
        if (!primaryEmail) {
            primaryEmail = canonicalizeEmail(this.#spec?.email || this.#spec?.companyEmail || this.#passmower?.email || this.#github?.emails?.find(ghEmail => ghEmail.primary)?.email || this.#github?.emails?.find(ghEmail => ghEmail.email)?.email || identityEmails.find(e => e.primary)?.email || identityEmails.find(e => e.email)?.email)
        }
        const groups = [...(this.#spec?.groups ?? []), ...(this.#passmower?.groups ?? []), ...(this.#github?.groups ?? []), ...activeIdentities.flatMap(i => i.groups ?? [])]
        return {
            primaryEmail,
            emails,
            groups: [...new Map(groups.map(g => [`${g.prefix}:${g.name}`, g])).values()],
            profile: {
                name: this.#spec?.name ?? this.#passmower?.name ?? this.#github?.name ?? identities.find(i => i.name)?.name ?? null,
                company: this.#spec?.company ?? this.#passmower?.company ?? this.#github?.company ?? identities.find(i => i.company)?.company ?? null,
                phones: this.#spec?.phones ?? null,
            },
            slackId: this.#slack?.id ?? null,
            passkeyCount: this.#webauthn?.credentials?.length ?? 0,
            conditions: this.#conditions.filter(condition => condition.type !== 'ToSv1'),
            termsOfService: this.#getIntendedTermsOfServiceAcceptance(termsOfService),
            recentApplications: this.#recentApplications,
            emailVerifications: this.getEmailVerifications(),
        }
    }

    getProfileResponse(forAdmin = false, requesterAccountId = null, termsOfService = getTermsOfServiceDocument()) {
        let profile =  {
            emails: this.emails,
            email: this.primaryEmail,
            name: this.profile.name,
            company: this.profile.company,
            phones: this.profile.phones,
            isAdmin: this.isAdmin,
            groups: this.#mapGroups(),
            terms_of_service_configured: !!termsOfService,
            tos_accepted_at: this.getTermsOfServiceAcceptance()?.acceptedAt,
        }
        if (forAdmin) {
            profile = {
                ...profile,
                accountId: this.accountId,
                type: this.type,
                impersonationEnabled: requesterAccountId !== this.accountId && canImpersonateAccount(this),
                approved: this.isAdmin || (new Approved()).check(this),
                conditions: this.#conditions,
                onboardedBy: this.#passmower?.onboardedBy ?? null,
                // Refined read-only activity projection for the admin UI. Do not
                // expose the rest of the CRD status or any raw audit-log fields.
                recentApplications: this.#recentApplications.map(application => ({
                    clientId: application.clientId,
                    namespace: application.clientNamespace,
                    name: application.clientName,
                    kind: application.clientKind,
                    lastAuthenticatedAt: application.lastAuthenticatedAt,
                })),
            }
        }
        return profile
    }

    getRemoteHeaders(headerMapping) {
        return Object.fromEntries([
            [headerMapping['user'], this.accountId],
            [headerMapping['name'], this.profile.name],
            [headerMapping['email'], this.primaryEmail],
            [headerMapping['groups'], this.#mapGroups().map(g => g.displayName).join(',')],
        ].filter(([header, value]) => header && value != null))
    }

    getSpecs() {
        return {
            passmower: this.#passmower,
            slack: this.#slack,
            github: this.#github,
            identities: this.#identities,
            webauthn: this.#webauthn,
        }
    }

    get webauthn() {
        return this.#webauthn
    }

    get username() {
        return this.accountId
    }

    // OIDCUser spec.type: person | org | service | banned | group (may be unset
    // for accounts created before the field was populated — treated as person).
    get type() {
        return this.#spec?.type ?? null
    }

    addCondition(condition) {
        return condition.add(this)
    }

    getConditions() {
        return this.#conditions
    }

    setConditions(conditions) {
        this.#conditions = conditions
        return this
    }

    getTermsOfServiceAcceptance() {
        if (this.#termsOfService) return this.#termsOfService
        const legacy = this.#conditions.find(condition => condition.type === 'ToSv1' && condition.status === 'True')
        return legacy ? {
            acceptedAt: legacy.lastTransitionTime ?? null,
            contentHash: null,
        } : undefined
    }

    #getIntendedTermsOfServiceAcceptance(document) {
        const acceptance = this.getTermsOfServiceAcceptance()
        if (!acceptance || acceptance.contentHash !== null) return acceptance
        return document ? {...acceptance, contentHash: document.contentHash} : acceptance
    }

    acceptTermsOfService(contentHash, acceptedAt = new Date()) {
        this.#termsOfService = {
            acceptedAt: acceptedAt instanceof Date ? acceptedAt.toISOString() : acceptedAt,
            contentHash,
        }
        this.#conditions = this.#conditions.filter(condition => condition.type !== 'ToSv1')
        return this
    }

    getRecentApplications() {
        return this.#recentApplications
    }

    setRecentApplications(recentApplications) {
        this.#recentApplications = recentApplications
        return this
    }

    getLabels() {
        return this.#labels
    }

    setLabels(labels) {
        this.#labels = labels
        return this
    }

    getMetadata() {
        return this.#metadata
    }

    getClaimedEmails() {
        const identities = Object.values(this.#identities ?? {})
        return [...new Set([
            this.#spec?.email,
            this.#spec?.companyEmail,
            this.#passmower?.email,
            ...(this.#github?.emails ?? []).map(item => item.email),
            ...identities.flatMap(identity => (identity.emails ?? []).map(item => item.email)),
        ].map(canonicalizeEmail).filter(Boolean))]
    }

    getEmailVerifications() {
        const evidence = this.#emailVerifications
            .filter(item => item.method === 'magic-link')
            .map(item => ({...item, email: canonicalizeEmail(item.email)}))
        for (const item of this.#github?.emails ?? []) {
            const email = canonicalizeEmail(item.email)
            if (!email) continue
            evidence.push({
                email,
                status: item.verified === true ? 'verified' : item.verified === false ? 'unverified' : 'unknown',
                method: 'github-api',
                provider: 'github',
                ...(item.observedAt ? {observedAt: item.observedAt} : {}),
            })
        }
        for (const [provider, identity] of Object.entries(this.#identities ?? {})) {
            if (identity.active === false) continue
            for (const item of identity.emails ?? []) {
                const email = canonicalizeEmail(item.email)
                if (!email) continue
                evidence.push({
                    email,
                    status: item.verified === true ? 'verified' : item.verified === false ? 'unverified' : 'unknown',
                    method: 'oidc-claim',
                    provider,
                    ...(item.observedAt ? {observedAt: item.observedAt} : {}),
                })
            }
        }
        return [...new Map(evidence.map(item => [
            `${item.email}\0${item.method}\0${item.provider}`,
            item,
        ])).values()]
    }

    isPrimaryEmailVerified() {
        const primaryEmail = canonicalizeEmail(this.primaryEmail)
        if (!primaryEmail) return false
        return this.getEmailVerifications().some(item =>
            item.email === primaryEmail && item.status === 'verified')
    }

    verifyEmail(email, {method = 'magic-link', provider = 'passmower', verifiedAt = new Date()} = {}) {
        email = canonicalizeEmail(email)
        if (!email || !this.getClaimedEmails().includes(email)) return this
        const verification = {
            email, status: 'verified', method, provider,
            verifiedAt: verifiedAt instanceof Date ? verifiedAt.toISOString() : verifiedAt,
        }
        this.#emailVerifications = [
            ...this.#emailVerifications.filter(item => !(
                canonicalizeEmail(item.email) === email
                && item.method === method
                && item.provider === provider
            )),
            verification,
        ]
        return this
    }

    getIdentity(providerKey) {
        return this.#identities?.[providerKey]
    }

    getGithubId() {
        return this.#github?.id
    }

    pushCustomGroup(name) {
        const group = {
            prefix: GroupPrefix,
            name
        }
        if (!this.#passmower.groups) {
            this.#passmower.groups = []
        }
        this.#passmower.groups.push(group)
        return this
    }

    #mapGroups() {
        return this.groups ? this.groups.map((g) => {
            return {
                name: g.name,
                prefix: g.prefix,
                displayName: g.prefix + ':' + g.name,
                // Only locally-created groups (under GROUP_PREFIX) are editable;
                // any group synced from an upstream provider is read-only.
                editable: g.prefix === GroupPrefix && process.env.DISABLE_FRONTEND_EDIT !== 'true',
            }
        }).sort(g => g.editable ? 1 : -1) : []
    }

    static getUid()
    {
        const uid = new ShortUniqueId({
            dictionary: 'alphanum_lower',
        });
        // rnd() not stamp(): stamp() embeds the creation timestamp, leaving only a
        // couple of random chars, so two accounts created in the same millisecond can
        // collide (the CR create then silently fails) and the creation time leaks from
        // the id (#13). A fully random 10-char id over 36 symbols avoids both.
        return 'u' + uid.rnd(10);
    }

    static async createOrUpdateByEmails(ctx, provider, email, githubEmails, username, preferredUsername, identity = {}) {
        if (Array.isArray(githubEmails)) {
            githubEmails = githubEmails.map((e) => {
                const ghEmail = canonicalizeEmail(e.email)
                return {
                    email: ghEmail,
                    primary: e.primary,
                    verified: typeof e.verified === 'boolean' ? e.verified : undefined,
                    observedAt: e.observedAt,
                }
            })
            githubEmails = [...new Map(githubEmails.map(v => [v.email, v])).values()]
        }
        const emails = [
            canonicalizeEmail(email),
            ...(githubEmails ?? []).map(ghEmail => ghEmail.email)
        ].filter(e => e)
        auditLog(ctx, {emails, email, githubEmails, username}, 'Finding user by emails')
        let user
        try {
            const users = await ctx.kubeOIDCUserService.listUsers()
            if (identity.providerKey && identity.subject) {
                user = await ctx.kubeOIDCUserService.findUserByIdentity(identity.providerKey, identity.subject, users)
            } else if (identity.githubId !== undefined) {
                user = await ctx.kubeOIDCUserService.findUserByGithubId(identity.githubId, users)
            }
            const emailUser = await ctx.kubeOIDCUserService.findUserByEmails(emails, users)
            if (user && emailUser && user.accountId !== emailUser.accountId) {
                throw new IdentityIntegrityError('Stable upstream identity and email resolve to different OIDC users', {
                    identityAccountId: user.accountId,
                    emailAccountId: emailUser.accountId,
                })
            }
            user ??= emailUser
        } catch (error) {
            if (!(error instanceof IdentityIntegrityError)) throw error
            auditLog(ctx, {emails, identity, error: error.message}, 'Identity resolution blocked by integrity conflict')
            return undefined
        }
        if (!user) {
            auditLog(ctx, {emails, email, githubEmails, username}, 'User not found')
            // `username` is set explicitly only by the admin invite path; otherwise
            // USERNAME_SOURCE decides how the new accountId is determined.
            if (!username) {
                if (process.env.ENROLL_USERS === 'false') {
                    auditLog(ctx, {emails, email, githubEmails, username}, 'User enrollment disabled')
                    return undefined
                }
                const source = getUsernameSource()
                if (source === 'prompt') {
                    return await requireCustomUsername(ctx, provider, {email, githubEmails, preferredUsername, identity})
                } else if (source === 'upstream') {
                    const candidate = sanitizeUsername(preferredUsername)
                    if (candidate && isUsernameValid(candidate) && await isUsernameAvailable(ctx, candidate)) {
                        username = candidate
                    } else {
                        // No usable upstream username — fall back to the prompt form.
                        return await requireCustomUsername(ctx, provider, {email, githubEmails, preferredUsername: candidate ?? preferredUsername, identity})
                    }
                }
                // source === 'generated' → leave username unset; getUid() below.
            }
            user = await ctx.kubeOIDCUserService.createUser(username ?? this.getUid(), email, githubEmails, identity)
            if (user) {
                auditLog(ctx, {emails, email, githubEmails, username}, 'Created new user')
            } else {
                auditLog(ctx, {emails, email, githubEmails, username, error: true}, 'Failed to create user in Kubernetes')
                return undefined
            }
        }
        const slackId = await getSlackId(user)
        return await ctx.kubeOIDCUserService.updateUserSpecs(
            user.accountId,
            {
                slack: {
                    id: slackId,
                },
        });
    }

    static async findAccount(ctx, id, token) { // eslint-disable-line no-unused-vars
        // token is a reference to the token used for which a given account is being loaded,
        // it is undefined in scenarios where account claims are returned from authorization endpoint
        // ctx is the koa request context
        return await ctx.kubeOIDCUserService.findUser(id, ctx) || null
    }

    static async findByEmail(ctx, email) {
        email = canonicalizeEmail(email)
        return await ctx.kubeOIDCUserService.findUserByEmails([email])
    }

    static async approve(ctx, accountId) {
        let account = await Account.findAccount(ctx, accountId)
        let condition = new Approved()
        condition.add(account)
        await ctx.kubeOIDCUserService.updateUserSpecs(account.accountId, account.getSpecs())
    }
}

export default Account;
