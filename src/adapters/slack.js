import {WebClient} from "@slack/web-api";

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
}
