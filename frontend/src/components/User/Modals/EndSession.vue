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
import {useToast} from "vue-toast-notification";
import {useImpersonationStore} from "@/stores/impersonation";

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
    ...mapState(useImpersonationStore, ['impersonation']),
  },
  methods: {
    ...mapActions(useAccountStore, ['setSessions']),
    ...mapActions(useImpersonationStore, ['setImpersonation']),
    closeModal,
    endSession () {
      if (this.impersonation) {
        fetch('/admin/api/account/impersonation/end', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
          },
        }).then((r) => r.json()).then((r) => {
          this.setImpersonation(r.impersonation)
        }).catch((e) => {
          console.error(e)
          const $toast = useToast();
          $toast.error('Ending impersonation failed', {
            position: 'top-right'
          });
        })
      } else {

      }

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
              return []
            } else {
              return r.json()
            }
          })
          .then((r) => {
            this.setSessions(r.sessions)
          }).catch((e) => {
            console.error(e)
            const $toast = useToast();
            $toast.error('Ending session failed', {
                position: 'top-right'
            });
          }).finally(() => {
            closeModal()
          })
    }
  }
}
</script>

<style scoped>

</style>