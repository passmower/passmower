import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => {
      return {
        account: {
          name: null,
          company: null,
          emails: [],
        },
        originalAccount: {},
        sessions: [],
      }
    },
    actions: {
        setAccount(account) {
            this.account = account
            this.originalAccount = Object.assign({},this.account)
        },
        setSessions(sessions) {
            this.sessions = sessions
        },
    },
})
