import {V1Condition} from "@kubernetes/client-node";
import {defaultApiGroupVersion} from "../kube-constants.js";

export const conditionStatusTrue = 'True'
export const conditionStatusFalse = 'False'

export class BaseCondition {
    type
    status

    setStatus(status) {
        this.status = status
        return this
    }

    toKubeCondition() {
        const condition = new V1Condition()
        condition.apiVersion = defaultApiGroupVersion
        condition.kind = 'Condition'
        condition.lastTransitionTime = new Date
        condition.status = this.status ? conditionStatusTrue : conditionStatusFalse
        condition.type = this.type
        return condition
    }

    check(account) {
        return account?.getConditions()?.find(c => c.type === this.type)?.status === conditionStatusTrue ?? false
    }
}
