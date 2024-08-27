import { defineStore } from 'pinia'

export const userAdminStore = defineStore('admin', {
    state: () => {
      return {
          groupPrefix: null,
          requireUsername: false,
          disableEditing: false,
          disableEditingText: null,
      }
    },
    actions: {
        setGroupPrefix(groupPrefix) {
            this.groupPrefix = groupPrefix
        },
        setRequireUsername(val) {
            this.requireUsername = val
        },
        setDisableEditing(val) {
            this.disableEditing = val
        },
        setDisableEditingText(val) {
            this.disableEditingText = val
        },
    },
})
