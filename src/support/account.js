import ShortUniqueId from "short-unique-id";
import {GitHubGroupPrefix} from "./kube-constants.js";
import {Approved} from "./conditions/approved.js";
import {getSlackId} from "./get-slack-id.js";
import {auditLog} from "./audit-log.js";

export const AdminGroup = process.env.ADMIN_GROUP;
export const GroupPrefix = process.env.GROUP_PREFIX;

class Account {
    #spec = null
    #conditions = []
    #labels = {}
    #metadata = {}

    fromKubernetes(apiResponse) {
        this.accountId = apiResponse.metadata.name
        this.#spec = apiResponse.spec
        this.resourceVersion = apiResponse.metadata.resourceVersion
        this.primaryEmail = apiResponse.status?.primaryEmail
        this.emails = apiResponse.status?.emails ?? []
        this.groups = apiResponse.status?.groups ?? []
        this.profile = apiResponse.status?.profile ?? {}
        this.slackId = apiResponse.status?.slackId ?? null
        this.#conditions = apiResponse.status?.conditions ?? []
        this.#labels = apiResponse.metadata?.labels ?? {}
        this.#metadata = apiResponse.metadata
        this.isAdmin = !!this.#mapGroups().find(g => g.displayName === AdminGroup)
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
     */
    async claims(use, scope) { // eslint-disable-line no-unused-vars
        let claims = {
            sub: this.accountId, // it is essential to always return a sub claim
            username: this.accountId,
            groups: this.groups,
            email: this.primaryEmail,
        };
        if (this.profile) {
            claims = {
                ...claims,
                name: this.profile.name,
                emails: this.emails,
                company: this.profile.company,
                githubId: this.profile.githubId,
            };
        }
        return claims
    }

    getIntendedStatus() {
        const emails = [
            this.#spec.email,
            this.#spec.companyEmail,
            ...(this.#spec.githubEmails ?? []).map(ghEmail => ghEmail.email)
        ].filter(e => e)
        let primaryEmail
        const preferredDomain = process.env.PREFERRED_EMAIL_DOMAIN
        if (preferredDomain) {
            const emailsWithDomains = emails.map(e => {
                return {
                    email: e,
                    domain: e.split('@')[1]
                }
            })
            primaryEmail = emailsWithDomains.find(e => e.domain === preferredDomain)
            primaryEmail = primaryEmail?.email
        }
        if (!primaryEmail) {
            primaryEmail = this.#spec.email || this.#spec.githubEmails.find(ghEmail => ghEmail.primary)?.email
        }
        return {
            primaryEmail,
            emails,
            groups: [...(this.#spec.customGroups ?? []), ...(this.#spec.githubGroups ?? [])],
            profile: {
                name: this.#spec.customProfile?.name ?? this.#spec.githubProfile?.name ?? null,
                company: this.#spec.customProfile?.company ?? this.#spec.githubProfile?.company ?? null,
            },
            slackId: this.#spec?.slackId ?? null,
            conditions: this.#conditions
        }
    }

    getProfileResponse(forAdmin = false, requesterAccountId = null) {
        let profile =  {
            emails: this.emails,
            email: this.primaryEmail,
            name: this.profile.name,
            company: this.profile.company,
            isAdmin: this.isAdmin,
            groups: this.#mapGroups(),
        }
        if (forAdmin) {
            profile = {
                ...profile,
                accountId: this.accountId,
                impersonationEnabled: requesterAccountId !== this.accountId,
                approved: this.isAdmin || (new Approved()).check(this),
                conditions: this.#conditions
            }
        }
        return profile
    }

    getRemoteHeaders(headerMapping) {
        return {
            [headerMapping['user']]: this.accountId,
            [headerMapping['name']]: this.profile.name,
            [headerMapping['email']]: this.primaryEmail,
            [headerMapping['groups']]: this.#mapGroups().map(g => g.displayName).join(',')
        }
    }

    getSpec() {
        return this.#spec
    }

    addCondition(condition) {
        return condition.add(this)
    }

    getConditions() {
        return this.#conditions
    }

    pushCondition(condition) {
        this.#conditions.push(condition)
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

    pushCustomGroup(name) {
        const group = {
            prefix: GroupPrefix,
            name
        }
        if (!this.#spec.customGroups) {
            this.#spec.customGroups = []
        }
        this.#spec.customGroups.push(group)
        return this
    }

    #mapGroups() {
        return this.groups ? this.groups.map((g) => {
            return {
                name: g.name,
                prefix: g.prefix,
                displayName: g.prefix + ':' + g.name,
                editable: g.prefix !== GitHubGroupPrefix,
            }
        }).sort(g => g.editable ? 1 : -1) : []
    }

    static getUid()
    {
        const uid = new ShortUniqueId({
            dictionary: 'alphanum_lower',
        });
        return 'u' + uid.stamp(10);
    }

    static async createOrUpdateByEmails(ctx, provider, email, githubEmails, username) {
        const emails = [
            email,
            ...(githubEmails ?? []).map(ghEmail => ghEmail.email)
        ].filter(e => e)
        auditLog(ctx, {emails, email, githubEmails, username}, 'Finding user by emails')
        let user = await ctx.kubeOIDCUserService.findUserByEmails(emails)
        if (!user) {
            auditLog(ctx, {emails, email, githubEmails, username}, 'User not found')
            if (!username && process.env.ENROLL_USERS === 'false') {
                auditLog(ctx, {emails, email, githubEmails, username}, 'User enrollment disabled')
                return undefined
            } else if (!username && process.env.REQUIRE_CUSTOM_USERNAME === 'true') {
                const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
                await provider.interactionResult(ctx.req, ctx.res, {
                    requireCustomUsername: true,
                    email,
                    githubEmails,
                    ...interactionDetails.result
                },{
                    mergeWithLastSubmission: true,
                })
                auditLog(ctx, {emails, email, githubEmails, username, interactionDetails}, 'Requiring custom username')
                return undefined
            }
            user = await ctx.kubeOIDCUserService.createUser(username ?? this.getUid(), email, githubEmails)
            if (user) {
                auditLog(ctx, {emails, email, githubEmails, username}, 'Created new user')
            } else {
                auditLog(ctx, {emails, email, githubEmails, username, error: true}, 'Failed to create user in Kubernetes')
                return undefined
            }
        }
        const slackId = await getSlackId(user)
        return await ctx.kubeOIDCUserService.updateUserSpec({
            accountId: user.accountId,
            slackId,
            githubEmails
        });
        // const redis = new RedisAdapter('Account')
        // await redis.upsert(user.accountId, updatedUser, 60)
        // return updatedUser
    }

    static async findAccount(ctx, id, token) { // eslint-disable-line no-unused-vars
        // token is a reference to the token used for which a given account is being loaded,
        // it is undefined in scenarios where account claims are returned from authorization endpoint
        // ctx is the koa request context
        const account = await ctx.kubeOIDCUserService.findUser(id)
        // const redis = new RedisAdapter('Account')
        // const cachedUser = await redis.find(id)
        // const account = cachedUser ? (new Account()).fromRedis(cachedUser) : await ctx.kubeApiService.findUser(id)
        // await redis.upsert(id, account, 60)
        return account ? account : null
    }

    static async findByEmail(ctx, email) {
        return await ctx.kubeOIDCUserService.findUserByEmails([email])
    }

    static async approve(ctx, accountId) {
        let account = await Account.findAccount(ctx, accountId)
        let condition = new Approved()
        condition.add(account)
        await ctx.kubeOIDCUserService.updateUserSpec({
            ...account.getSpec(),
            accountId: account.accountId
        })
    }
}

export default Account;
