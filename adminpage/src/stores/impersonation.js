import { defineStore } from 'pinia'

export const useImpersonationStore = defineStore('impersonation', {
    state: () => {
      return {
          impersonation: null,
      }
    },
    actions: {
        setImpersonation(impersonation) {
            this.impersonation = impersonation
        },
    },
})
