import { ToSv1 } from "../../conditions/tosv1.js"

// Whether the account must accept the Terms of Service before continuing.
// ToS only applies to people — service accounts, orgs and groups skip it
// (#62). An account with no type set is treated as a person.
export const tosRequired = (account) => {
    const type = account?.type
    if (type && type !== 'person') {
        return false
    }
    return !(new ToSv1()).check(account)
}
