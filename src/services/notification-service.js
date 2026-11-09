import EmailAdapter from "../adapters/email.js";
import {SlackAdapter} from "../adapters/slack.js";
import {isOutboundEmailEnabled} from "../utils/email-configuration.js";
import RedisAdapter from "../adapters/redis.js";
import {adminRequestMessage} from "../utils/slack-message.js";

export const loginNotificationsEnabled = (env = process.env) => env.NOTIFY_ON_LOGIN === 'true'
export const impersonationNotificationsEnabled = (env = process.env) => env.NOTIFY_ON_IMPERSONATION !== 'false'
export const adminRequestNotificationsEnabled = (env = process.env) => env.NOTIFY_ADMINS_ON_REQUESTS === 'true'

// One notice per waiting request per day: the approval page is re-rendered on
// every refresh, and an impatient user must not page the administrators.
const ADMIN_NOTICE_INTERVAL_SECONDS = 24 * 3600

// Broadcast a short security notice to every channel the account has: email
// (when delivery is enabled) and a Slack DM (when the workspace integration is
// configured and the user is linked). Best-effort: a notification failure must
// never affect the flow that triggered it.
export const notifyAccount = async (account, subject, text, {
    emailAdapter = new EmailAdapter(),
    slackAdapter = new SlackAdapter(),
    env = process.env,
    slackMessage,
} = {}) => {
    if (!account) return
    const deliveries = []
    if (isOutboundEmailEnabled(env) && account.primaryEmail) {
        deliveries.push(emailAdapter.sendMail(account.primaryEmail, subject, text)
            .catch(error => globalThis.logger?.warn(
                {error: error.message, accountId: account.accountId},
                'Failed to send notification email')))
    }
    if (env.SLACK_TOKEN && account.slackId) {
        // Callers with nothing to lay out keep sending exactly the plain payload.
        const message = slackMessage
            ? [slackMessage.text, slackMessage.blocks]
            : [`*${subject}*\n${text}`]
        deliveries.push(slackAdapter.sendMessage(account.slackId, ...message)
            .catch(error => globalThis.logger?.warn(
                {error: error.message, accountId: account.accountId},
                'Failed to send notification Slack message')))
    }
    await Promise.all(deliveries)
}

// Tells every administrator that a user is waiting for approval or asked for
// access (#17), over the same channels as notifyAccount. `key` identifies the
// request so repeats within a day are not sent again. Best-effort and never
// awaited by the login flow.
export const notifyAdminsOfRequest = async ({key, summary, detail, listUsers, env = process.env, ...adapters}) => {
    if (!adminRequestNotificationsEnabled(env)) return
    try {
        const sent = new RedisAdapter('AdminNotice')
        if (await sent.find(key)) return
        await sent.upsert(key, {ts: Math.floor(Date.now() / 1000)}, ADMIN_NOTICE_INTERVAL_SECONDS)
        const url = `${env.ISSUER_URL}admin`
        const text = [detail, `Review it in the admin panel: ${url}`].filter(Boolean).join('\n')
        const admins = (await listUsers()).filter(account => account.isAdmin && !account.disabled)
        await Promise.all(admins.map(admin => notifyAccount(admin, summary, text, {
            env,
            ...adapters,
            slackMessage: adminRequestMessage({summary, detail, url, text: `${summary}\n${text}`}),
        })))
    } catch (error) {
        globalThis.logger?.warn({error: error.message, key}, 'Failed to notify administrators of a request')
    }
}
