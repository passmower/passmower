<template>
  <header>
      <a href="/profile">Profile</a>
      <a v-if="account.isAdmin" href="/admin">Admin panel</a>
  </header>

  <main>
    <div class="card card-wide">
      <h1>Hello, {{ account.name }}!</h1>
      <Apps />
    </div>
  </main>
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import Apps from "@/components/User/Apps.vue";
import {useAppsStore} from "./stores/apps";
import {useAccountStore} from "./stores/account";

export default {
  components: {
    Apps,
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['account']),
  },
  created() {
    fetch('/api/me').then((r) => r.json()).then((r) => {
      this.setAccount(r)
    })
    fetch('/api/apps').then((r) => r.json()).then((r) => {
      this.setApps(r.apps)
    })
  },
  methods: {
    ...mapActions(useAppsStore, ['setApps']),
    ...mapActions(useAccountStore, ['setAccount', 'setSessions']),
  }
}

</script>
