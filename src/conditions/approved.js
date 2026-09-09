import {BaseCondition} from "./base-condition.js";
import {AdminGroup, GroupPrefix} from "../models/account.js";

// Whether an account satisfies the global REQUIRED_GROUP policy. Two things can
// satisfy it: membership of that group (or of ADMIN_GROUP), or an explicit
// approval by an administrator.
//
// Approval used to be implemented by granting the account the required group
// with the *local* prefix substituted in, which meant it only ever worked when
// REQUIRED_GROUP was a local group — and reported success regardless (#235).
// It is now recorded as its own fact, so approving works whatever
// REQUIRED_GROUP names, and Passmower never writes a group belonging to an
// upstream directory onto an account that is not in it.
export class Approved extends BaseCondition {
    type = 'Approved'
    requiredGroup = process.env.REQUIRED_GROUP

    check(account) {
        if (!this.requiredGroup) {
            return true // don't require any group if REQUIRED_GROUP is not set
        }
        if (account?.isApproved()) {
            return true
        }
        const accountGroups = account?.getProfileResponse()?.groups ?? []
        return accountGroups.some(g => g.displayName === this.requiredGroup || g.displayName === AdminGroup)
    }

    add(account) {
        account.setApproved()
        // When REQUIRED_GROUP is a group Passmower owns, keep granting it as
        // well: clients gating on that group with allowedGroups have always
        // seen approved users, and that should not change.
        const localPrefix = GroupPrefix ? `${GroupPrefix}:` : null
        if (localPrefix && this.requiredGroup?.startsWith(localPrefix)) {
            account.pushCustomGroup(this.requiredGroup.slice(localPrefix.length))
        }
        return account
    }
}
