import {SlackAdapter} from "../adapters/slack.js";
import {ErrorCode} from "@slack/web-api";

export const getSlackId = async (user) => {
    if (user.slackId) {
        return user.slackId
    }
    const adapter = new SlackAdapter()
    if (!adapter.client) {
        return undefined
    }
    let userId = undefined
    await Promise.all(user.emails.map(async email => {
        const found = await adapter.getUserId(email)
        if (found) {
            userId = found
        }
    }))
    return userId
}
