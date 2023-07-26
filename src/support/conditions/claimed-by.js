import {BaseCondition} from "./base-condition.js";
import {defaultApiGroup} from "../kube-constants.js";
import kebabCase from "../kebab-case.js";

export class ClaimedBy extends BaseCondition {
    type = 'ClaimedBy'
    #gatewayName
    #labelKey
    #labels = {}

    constructor(currentGateway) {
        super();
        this.#gatewayName = currentGateway
        this.#labelKey = `${defaultApiGroup}/${kebabCase(this.type)}`
    }

    check(account) {
        return !!account.getLabels()?.[this.#labelKey]
    }

    setStatus(status) {
        this.#labels = status ? {
            [this.#labelKey]: this.#gatewayName
        } : {}
        return this
    }

    toLabels() {
        return this.#labels
    }
}
