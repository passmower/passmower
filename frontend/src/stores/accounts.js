import { defineStore } from 'pinia'

export const useAccountsStore = defineStore('accounts', {
    state: () => {
      return {
          accounts: [],
      }
    },
    actions: {
        setAccounts(accounts) {
            this.accounts = accounts
        },
    },
})
