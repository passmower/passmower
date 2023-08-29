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

    check(resource) {
        return resource?.getConditions()?.find(c => c.type === this.type)?.status === conditionStatusTrue ?? false
    }

    add(resource) {
        const conditions = resource.getConditions()
        conditions.push(this.toKubeCondition())
        return resource.setConditions(conditions)
    }

    set(resource) {
        const conditions =  resource?.getConditions() || []
        const exists = conditions.findIndex(c => c.type === this.type)
        exists !== -1 ? conditions[exists] = this.toKubeCondition() : conditions.push(this.toKubeCondition())
        return resource.setConditions(conditions)
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
}
