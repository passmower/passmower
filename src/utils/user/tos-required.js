import crypto from 'node:crypto'
import {getTermsOfService} from '../get-text.js'

export const getTermsOfServiceDocument = () => {
    const text = getTermsOfService()
    return text === null ? null : {
        text,
        contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    }
}

// Whether the account must accept the Terms of Service before continuing.
// ToS only applies to people — service accounts, orgs and groups skip it
// (#62). An account with no type set is treated as a person.
export const tosRequired = (account, document = getTermsOfServiceDocument()) => {
    const type = account?.type
    if ((type && type !== 'person') || !document) return false
    const acceptance = account?.getTermsOfServiceAcceptance()
    // A null hash comes from the legacy ToSv1 condition. Reconciliation records
    // the current hash as its baseline without forcing an upgrade-time prompt.
    return !acceptance || (acceptance.contentHash !== null
        && acceptance.contentHash !== document.contentHash)
}
