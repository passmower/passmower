<template>
  <header>
  </header>

  <main>
    <div class="login-card">
      <h1>Hello, {{ account.name }}!</h1>
      <Profile />
      <Sessions />
    </div>
  </main>
  <widget-container-modal />
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import Profile from "@/components/Profile.vue";
import Sessions from "@/components/Sessions.vue";
import {container} from "jenesius-vue-modal";

export default {
  components: {
    Profile,
    Sessions,
    WidgetContainerModal: container,
  },
  data() {
    return {
      examineLogContent: null,
    }
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['account']),
  },
  created() {
    fetch('/api/me').then((r) => r.json()).then((r) => {
      this.setAccount(r)
    })
    fetch('/api/sessions').then((r) => r.json()).then((r) => {
      this.setSessions(r.sessions)
    })
  },
  methods: {
    ...mapActions(useAccountStore, ['setAccount', 'setSessions']),
  }
}

</script>
