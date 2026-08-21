import {Approved} from '../../conditions/approved.js'
import {checkAccountGroups} from './check-account-groups.js'
import {tosRequired} from './tos-required.js'

export const getAccountAccessFailure = (client, account) => {
    if (!account) return 'account_missing'
    if (!account.isAdmin && !(new Approved()).check(account)) return 'approval_required'
    if (!account.profile?.name) return 'name_required'
    if (tosRequired(account)) return 'tos_required'
    if (!checkAccountGroups(client, account)) return 'client_access_required'
    return null
}
