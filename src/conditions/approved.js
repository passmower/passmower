import {BaseCondition} from "./base-condition.js";
import {AdminGroup} from "../models/account.js";

export class Approved extends BaseCondition {
    type = 'Approved'
    requiredGroup = process.env.REQUIRED_GROUP

    check(account) {
        const accountGroups = account.getProfileResponse().groups
        return this.requiredGroup ?
            accountGroups.find(g => g.displayName === this.requiredGroup || g.displayName === AdminGroup)
            : true // don't require any group if REQUIRED_GROUP is not set
    }

    add(account) {
        if (this.requiredGroup && this.requiredGroup.includes(':')) {
            const parts = this.requiredGroup.split(':')
            parts.splice(0, 1)
            const requiredGroupName = parts.join(':')
            return account.pushCustomGroup(requiredGroupName)
        }
        return account
    }
}
