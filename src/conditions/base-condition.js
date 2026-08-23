import {V1Condition} from "@kubernetes/client-node";

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
        // Plain metav1.Condition shape — no apiVersion/kind. Those were only
        // ever added to satisfy the CRD schema's x-kubernetes-embedded-resource
        // marker, which was wrong (conditions are not embedded resources) and
        // made any CR whose conditions lacked them fail validation on every
        // subsequent update (kubectl apply on a reconciled OIDCClient broke).
        const condition = new V1Condition()
        condition.lastTransitionTime = new Date
        condition.status = this.status ? conditionStatusTrue : conditionStatusFalse
        condition.type = this.type
        return condition
    }
}
