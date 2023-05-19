import crypto from "node:crypto";
import Account from "../support/account.js";
import {OAuth2} from "oauth";
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import {GitHubGroupPrefix} from "../support/kube-constants.js";

export default async (ctx, provider) => {
    const ghOauth = new OAuth2(process.env.GH_CLIENT_ID,
        process.env.GH_CLIENT_SECRET,
        'https://github.com/',
        'login/oauth/authorize',
        'login/oauth/access_token',
        null);

    const callbackParams = ctx.request.body
    delete callbackParams['upstream']

    if (!Object.keys(callbackParams).length) {
        const state = `${ctx.params.uid}|${crypto.randomBytes(32).toString('hex')}`;
        await provider.interactionResult(ctx.req, ctx.res, {
            state,
        })
        ctx.status = 302;
        return ctx.redirect(ghOauth.getAuthorizeUrl({
            redirect_uri: `${process.env.ISSUER_URL}interaction/callback/gh`,
            scope: ['user:email,read:org'],
            state,
        }));
    }

    const details = await provider.interactionDetails(ctx.req, ctx.res)
    if (!details.result || details.result.state !== callbackParams.state) {
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
        return accessDenied(ctx, provider, 'User aborted login')
    }
    const token = accessToken.access_token

    const user = await fetch('https://api.github.com/user', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json());

    const emails = await fetch('https://api.github.com/user/emails', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json()).then((r) => r.map((r) => r.email));

    const account = await Account.createOrUpdateByEmails(ctx, emails);

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
    } catch (e) {
        console.error('Error getting groups from GitHub: ' + e)
    }

    await ctx.kubeOIDCUserService.updateUserSpec({
        accountId: account.accountId,
        githubProfile,
        githubGroups
    })

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account), {
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
