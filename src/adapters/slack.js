import {WebClient} from "@slack/web-api";

let teamIdPromise

export class SlackAdapter {
    constructor() {
        const token = process.env.SLACK_TOKEN;
        if (token) {
            this.client = new WebClient(token);
        }
    }
    async getUserId(email) {
        return await this.client.users.lookupByEmail({
            email
        }).then(r => r?.user?.id)
            .catch(error => {
            if (error?.data?.error === 'users_not_found') {
                globalThis.logger.error({
                    email,
                    error
                }, 'getting user by email from Slack failed')
            }
        })
    }

    async getTeamId() {
        if (!this.client) return undefined
        if (process.env.SLACK_TEAM_ID) return process.env.SLACK_TEAM_ID
        teamIdPromise ??= this.client.auth.test()
            .then(response => response.team_id)
            .catch(error => {
                teamIdPromise = undefined
                globalThis.logger?.error({error}, 'getting workspace ID from Slack failed')
                return undefined
            })
        return teamIdPromise
    }

    // `text` is always sent: Slack renders it in the notification and the
    // channel preview, and falls back to it wherever blocks cannot render.
    // `blocks` is optional so callers that have nothing to lay out keep sending
    // exactly the payload they did before.
    async sendMessage(userId, text, blocks) {
        return await this.client.chat.postMessage({
            channel: userId,
            text,
            ...(blocks?.length ? {blocks} : {}),
        })
    }
}
