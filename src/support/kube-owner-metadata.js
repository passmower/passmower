import {defaultApiGroup, defaultApiGroupVersion} from "./kube-constants.js";

export class KubeOwnerMetadata {
    constructor(kind, name, uid, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        this.kind = kind
        this.name = name
        this.uid = uid
        this.apiVersion = `${apiGroup}/${apiGroupVersion}`
    }
}
