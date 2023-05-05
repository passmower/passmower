import { defineStore } from 'pinia'

export const userAdminStore = defineStore('admin', {
    state: () => {
      return {
        groupPrefix: null,
      }
    },
    actions: {
        setGroupPrefix(groupPrefix) {
            this.groupPrefix = groupPrefix
        },
    },
})
