<template>
  <header>
  </header>

  <main>
    <div class="login-card">
      <h1>Hello, {{ account.name }}!</h1>
      <Accounts />
    </div>
  </main>
  <widget-container-modal />
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import {container} from "jenesius-vue-modal";
import Accounts from "@/components/Accounts.vue";

export default {
  components: {
    Accounts,
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
  },
  methods: {
    ...mapActions(useAccountStore, ['setAccount']),
  }
}

</script>
