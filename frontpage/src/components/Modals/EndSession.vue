<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Are you sure you want to end this session?</h2>
      <XMark @click="closeModal" />
    </div>
    <button type="submit" @click="endSession">Confirm</button>
  </div>
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import {closeModal} from "jenesius-vue-modal"

export default {
  name: "EndSession",
  components: {
    XMark
  },
  props: {
    sessionId: String
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['sessions']),
  },
  methods: {
    ...mapActions(useAccountStore, ['setSessions']),
    closeModal,
    endSession () {
      fetch('/api/session/end', {
        method: 'POST',
        body: JSON.stringify({
          id: this.sessionId
        }),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        redirect: 'follow'
      })
          .then((r) => {
            if (r.redirected) {
              window.location.replace(r.url);
            } else {
              return r.json()
            }
          })
          .then((r) => {
            this.setSessions(r.sessions)
          }).catch((e) => {
            console.error(e)
            // TODO: notify user.
          }).finally(() => {
            closeModal()
          })
    }
  }
}
</script>

<style scoped>

</style>