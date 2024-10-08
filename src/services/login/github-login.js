import crypto from "node:crypto";
import Account from "../../models/account.js";
import {OAuth2} from "oauth";
import accessDenied from "../../utils/session/access-denied.js";
import getLoginResult from "../../utils/user/get-login-result.js";
import {GitHubGroupPrefix} from "../../utils/kubernetes/kube-constants.js";
import {auditLog} from "../../utils/session/audit-log.js";

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
            scope: process.env.GITHUB_ORGANIZATION ? ['user:email,read:org'] : ['user:email'],
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

    const user = await fetch('https://api.github.com/user', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json());

    if (user.error) {
        auditLog(ctx, {error: user.error, interactionDetails, user}, 'Error getting profile from GitHub')
        return accessDenied(ctx, provider, 'Error getting profile from GitHub')
    }

    const account = await Account.createOrUpdateByEmails(ctx, provider, undefined, emails, undefined, user.login);

    if (!account?.accountId) {
        auditLog(ctx,{account, interactionDetails}, 'Unable to determine account from GitHub')
    } else {
        const githubProfile = {
            name: user.name,
            company: user.company,
            id: user.id,
            login: user.login,
        }

        let groups = []
        if (process.env.GITHUB_ORGANIZATION) {
            try {
                groups = await getOrganizationTeams(token, process.env.GITHUB_ORGANIZATION).then(teams => {
                    return Promise.all(teams.map(team => {
                        return getUserOrganizationTeamMembership(token, team, user.login)
                    }))
                }).then(g => g.filter(g => !!g))
                groups = groups.map(g => {
                    return {
                        prefix: GitHubGroupPrefix,
                        name: g,
                    }
                })
            } catch (error) {
                auditLog(ctx, {error, interactionDetails}, 'Error getting groups from GitHub')
            }
        }

        await ctx.kubeOIDCUserService.updateUserSpecs(
            account.accountId,
            {
                github: {
                    ...githubProfile,
                    groups,
                    emails
                }
            }
            )
    }

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, 'GitHub'), {
        mergeWithLastSubmission: false,
    });
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
