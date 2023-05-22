import ShortUniqueId from "short-unique-id";
import {GitHubGroupPrefix} from "./kube-constants.js";
import {conditionStatusTrue} from "./conditions/base-condition.js";
import RedisAdapter from "../adapters/redis.js";

export const AdminGroup = process.env.ADMIN_GROUP;

class Account {
    #spec = null
    #conditions = []

    fromKubernetes(apiResponse) {
        this.accountId = apiResponse.metadata.name
        this.#spec = apiResponse.spec
        this.resourceVersion = apiResponse.metadata.resourceVersion
        this.emails = apiResponse.status?.emails ?? []
        this.groups = apiResponse.status?.groups ?? []
        this.profile = apiResponse.status?.profile ?? {}
        this.#conditions = apiResponse.status?.conditions ?? []
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
            groups: this.groups,
            emails: this.emails,
        };
        if (this.profile) {
            claims = {
                ...claims,
                name: this.profile.name,
                email: this.emails[0],
                company: this.profile.company,
                githubId: this.profile.githubId,
            };
        }
        return claims
    }

    getIntendedStatus() {
        return {
            emails: this.#spec.emails,
            groups: [...(this.#spec.customGroups ?? []), ...(this.#spec.githubGroups ?? [])],
            profile: {
                name: this.#spec.customProfile?.name ?? this.#spec.githubProfile?.name ?? null,
                company: this.#spec.customProfile?.company ?? this.#spec.githubProfile?.company ?? null,
            },
            conditions: this.#conditions
        }
    }

    getProfileResponse(forAdmin = false, requesterAccountId = null) {
        let profile =  {
            emails: this.emails,
            email: this.emails[0],
            name: this.profile.name,
            company: this.profile.company,
            isAdmin: this.isAdmin,
            groups: this.#mapGroups(),
        }
        if (forAdmin) {
            profile = {
                ...profile,
                accountId: this.accountId,
                impersonationEnabled: requesterAccountId !== this.accountId
            }
        }
        return profile
    }

    getRemoteHeaders() {
        return {
            'Remote-User': this.accountId,
            'Remote-Name': this.profile.name,
            'Remote-Email': this.emails[0], // TODO: primary email?
            'Remote-Groups': this.#mapGroups().map(g => g.displayName).join(',')
        }
    }

    addCondition(condition) {
        this.#conditions.push(condition)
        return this
    }

    checkCondition(condition) {
        return this.#conditions.find(c => c.type === condition.type)?.status === conditionStatusTrue ?? false
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

    static async createOrUpdateByEmails(ctx, emails) {
        const user = await ctx.kubeOIDCUserService.findUserByEmails(emails)
        if (!user) {
            return await ctx.kubeOIDCUserService.createUser(this.getUid(), emails)
        }
        const allEmails = emails.concat(user.emails.filter((item) => emails.indexOf(item) < 0))
        const updatedUser = await ctx.kubeOIDCUserService.updateUserSpec({
            accountId: user.accountId,
            emails: allEmails
        });
        const redis = new RedisAdapter('Account')
        await redis.upsert(user.accountId, updatedUser, 60)
        return updatedUser
    }

    static async findAccount(ctx, id, token) { // eslint-disable-line no-unused-vars
        // token is a reference to the token used for which a given account is being loaded,
        // it is undefined in scenarios where account claims are returned from authorization endpoint
        // ctx is the koa request context
        const account = await ctx.kubeOIDCUserService.findUser(id)
        const redis = new RedisAdapter('Account')
        const cachedUser = await redis.find(id)
        const account = cachedUser ? (new Account()).fromRedis(cachedUser) : await ctx.kubeApiService.findUser(id)
        await redis.upsert(id, account, 60)
        return account ? account : null
    }
}

export default Account;
