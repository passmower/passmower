import { defineStore } from 'pinia'

export const userAdminStore = defineStore('admin', {
    state: () => {
      return {
          groupPrefix: null,
          requireUsername: false,
      }
    },
    actions: {
        setGroupPrefix(groupPrefix) {
            this.groupPrefix = groupPrefix
        },
        setRequireUsername(val) {
            this.requireUsername = val
        },
    },
})
