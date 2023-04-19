<template>
  <div class="profile-section">
    <div class="profile-section-header">
      <h2>Sessions</h2>
    </div>
    <div class="item" v-for="session in sessions">
      <div class="item-details">
        <h3>{{ session.browser }} on {{ session.os }} <span v-if="session.current">(current session)</span></h3>
        <p>Initial IP: {{ session.ip }}</p>
        <p>Created at: {{ session.created_at }}</p>
      </div>
      <XMark v-if="!session.current" @click="end(session)" />
    </div>
    <button type="submit" @click="end(sessions.find((s) => s.current))">Log out</button>
  </div>
</template>

<script>
import {mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import {openModal} from "jenesius-vue-modal";
import EndSession from "@/components/Modals/EndSession.vue";

export default {
  name: "Profile",
  components: {
    XMark,
    EndSession
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['sessions']),
  },
  methods: {
    async end(session) {
      const modal = await openModal(EndSession, {
        sessionId: session.id
      });
    }
  }
}
</script>

<style scoped>

</style>