import EmailAdapter from "../adapters/email.js";
import {SlackAdapter} from "../adapters/slack.js";
import {isEmailEnabled} from "../utils/email-configuration.js";

export const loginNotificationsEnabled = (env = process.env) => env.NOTIFY_ON_LOGIN === 'true'
export const impersonationNotificationsEnabled = (env = process.env) => env.NOTIFY_ON_IMPERSONATION !== 'false'

// Broadcast a short security notice to every channel the account has: email
// (when delivery is enabled) and a Slack DM (when the workspace integration is
// configured and the user is linked). Best-effort: a notification failure must
// never affect the flow that triggered it.
export const notifyAccount = async (account, subject, text, {
    emailAdapter = new EmailAdapter(),
    slackAdapter = new SlackAdapter(),
    env = process.env,
} = {}) => {
    if (!account) return
    const deliveries = []
    if (isEmailEnabled(env) && account.primaryEmail) {
        deliveries.push(emailAdapter.sendMail(account.primaryEmail, subject, text)
            .catch(error => globalThis.logger?.warn(
                {error: error.message, accountId: account.accountId},
                'Failed to send notification email')))
    }
    if (env.SLACK_TOKEN && account.slackId) {
        deliveries.push(slackAdapter.sendMessage(account.slackId, `*${subject}*\n${text}`)
            .catch(error => globalThis.logger?.warn(
                {error: error.message, accountId: account.accountId},
                'Failed to send notification Slack message')))
    }
    await Promise.all(deliveries)
}
