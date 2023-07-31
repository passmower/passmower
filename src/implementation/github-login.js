import crypto from "node:crypto";
import Account from "../support/account.js";
import {OAuth2} from "oauth";
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import {GitHubGroupPrefix} from "../support/kube-constants.js";
import {auditLog} from "../support/audit-log.js";

export default async (ctx, provider) => {
    const ghOauth = new OAuth2(process.env.GH_CLIENT_ID,
        process.env.GH_CLIENT_SECRET,
        'https://github.com/',
        'login/oauth/authorize',
        'login/oauth/access_token',
        null);

    const callbackParams = ctx.request.body
    delete callbackParams['upstream']

    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
    let token = interactionDetails?.lastSubmission?.oauth?.token

    if (!token && !Object.keys(callbackParams).length) {
        const state = `${ctx.params.uid}|${crypto.randomBytes(32).toString('hex')}`;
        await provider.interactionResult(ctx.req, ctx.res, {
            state,
        })
        ctx.status = 302;
        auditLog(ctx, {interactionDetails, state}, 'Redirecting user to GitHub')
        return ctx.redirect(ghOauth.getAuthorizeUrl({
            redirect_uri: `${process.env.ISSUER_URL}interaction/callback/gh`,
            scope: ['user:email,read:org'],
            state,
        }));
    }


    if (!token) {
        if (!interactionDetails.result || interactionDetails.result.state !== callbackParams.state) {
            auditLog(ctx, {error: true, interactionDetails}, 'State does not match')
            return accessDenied(ctx, provider,'State does not match')
        }

        const accessToken = await new Promise(resolve => {
            ghOauth.getOAuthAccessToken(callbackParams.code, {
                'redirect_uri': `${process.env.ISSUER_URL}interaction/callback/gh`,
            }, (e, access_token, refresh_token, results) => {
                resolve(results)
            });
        });

        if (accessToken.error || !accessToken.access_token) {
            auditLog(ctx, {error: accessToken.error, interactionDetails}, 'Error getting access token from GitHub')
            return accessDenied(ctx, provider, 'User aborted login')
        }

        token = accessToken.access_token
        await provider.interactionResult(ctx.req, ctx.res, {
            oauth: {
                provider: 'GitHub',
                token
            }
        })
    }

    const emails = await fetch('https://api.github.com/user/emails', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json()).then((r) => r.filter((r) => r.verified)).catch(error => {
        auditLog(ctx,{error, interactionDetails}, 'Error getting emails from GitHub')
    });

    if (!emails) {
        return accessDenied(ctx, provider, 'Error getting emails from GitHub')
    }

    const account = await Account.createOrUpdateByEmails(ctx, provider, undefined, emails);

    if (!account?.accountId) {
        auditLog(ctx,{account, interactionDetails}, 'Unable to determine account from GitHub')
    } else {
        const user = await fetch('https://api.github.com/user', {
            method: "GET",
            headers: {
                'Authorization': `Bearer ${token}`
            },
        }).then((r) => r.json());

        if (user.error || !user.name) {
            auditLog(ctx, {error: user.error, interactionDetails}, 'Error getting profile from GitHub')
            return accessDenied(ctx, provider, 'Error getting profile from GitHub')
        }

        const githubProfile = {
            name: user.name,
            company: user.company,
            id: user.id,
            login: user.login,
        }

        let githubGroups = []
        try {
            githubGroups = await getUserOrganizations(token).then(organizations => organizations.filter(filterUserOrganizations)).then(organizations => {
                return Promise.all(organizations.map(organization => {
                    return getOrganizationTeams(token, organization).then(teams => {
                        return Promise.all(teams.map(team => {
                            return getUserOrganizationTeamMembership(token, team, user.login)
                        }))
                    })
                })).then(g => {
                    g = g.flat(2).filter(r => !!r)
                    g = [
                        ...g,
                        ...organizations
                    ]
                    return g
                })
            })
            githubGroups = githubGroups.map(g => {
                return {
                    prefix: GitHubGroupPrefix,
                    name: g,
                }
            })
        } catch (error) {
            auditLog(ctx, {error, interactionDetails}, 'Error getting groups from GitHub')
        }

        await ctx.kubeOIDCUserService.updateUserSpec({
            accountId: account.accountId,
            githubProfile,
            githubGroups
        })
    }

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, 'GitHub'), {
        mergeWithLastSubmission: false,
    });
}

const filterUserOrganizations = (organization) => {
    return process.env.GITHUB_ORGANIZATION ? (organization === process.env.GITHUB_ORGANIZATION) : true
}

const getUserOrganizations = async (token) => {
    return await fetch(`https://api.github.com/user/memberships/orgs`, {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then(r => r.json()).then(r => r.filter(r => r.state === 'active')).then(r => r.map(r => r?.organization?.login.toLowerCase()))
}

const getOrganizationTeams = async (token, org) => {
    return await fetch( `https://api.github.com/orgs/${org}/teams`, {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json()).then(r => r.map(r => {
        return {
            ...r,
            organization: org
        }
    }));
}

const getUserOrganizationTeamMembership = async (token, team, userLogin) => {
    return await fetch(`https://api.github.com/orgs/${team.organization}/teams/${team.slug}/memberships/${userLogin}`, {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json()).then(r => r?.state === 'active' ? `${team.organization}:${team.slug}` : null);
}
