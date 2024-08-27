import {BaseCondition} from "./base-condition.js";
import {defaultApiGroup} from "../utils/kubernetes/kube-constants.js";
import kebabCase from "../utils/kebab-case.js";

export class ClaimedBy extends BaseCondition {
    type = 'ClaimedBy'
    #instance
    #labelKey
    #labels = {}

    constructor(instance) {
        super();
        this.#instance = instance
        this.#labelKey = `${defaultApiGroup}/${kebabCase(this.type)}`
    }

    check(account) {
        return !!account.getLabels()?.[this.#labelKey]
    }

    setStatus(status) {
        this.#labels = status ? {
            [this.#labelKey]: this.#instance
        } : {}
        return this
    }

    toLabels() {
        return this.#labels
    }
}
