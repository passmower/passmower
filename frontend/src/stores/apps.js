import { defineStore } from 'pinia'

export const useAppsStore = defineStore('apps', {
    state: () => {
      return {
        apps: []
      }
    },
    actions: {
        setApps(apps) {
            this.apps = apps
        },
    },
})
