// Module used to mock src/adapters/kubernetes.js so that every `new
// KubernetesAdapter()` in the app returns ONE shared in-memory fake the test can
// seed and inspect. A constructor that returns an object overrides `this`, so
// `new KubernetesAdapter()` yields the singleton.
import { FakeKubernetesAdapter } from './fake-kubernetes-adapter.js'

export const fakeKube = new FakeKubernetesAdapter()

export class KubernetesAdapter {
    constructor() {
        return fakeKube
    }
}
