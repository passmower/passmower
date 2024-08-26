<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Edit profile</h2>
      <XMark @click="closeModal" />
    </div>
    <template v-if="!account.disableEditing">
      <label for="name">Name: </label>
      <input name="name" type="text" v-model="account.name" />
      <label for="name">Company: </label>
      <input name="name" type="text" v-model="account.company" />
      <button type="submit" @click="saveAccount">Save changes</button>
    </template>
    <div v-else v-html="disableEditingText" />
  </div>
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import {closeModal} from "jenesius-vue-modal"
import {useToast} from "vue-toast-notification";

export default {
  name: "EditProfile",
  components: {
    XMark
  },
  data() {
    return {
      disableEditingText: ''
    }
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['account']),
  },
  created: async function () {
    this.disableEditingText = await fetch('/api/texts/disable_frontend_edit').then((r) => r.text())
  },
  methods: {
    ...mapActions(useAccountStore, ['setAccount']),
    closeModal,
    saveAccount () {
      fetch('/api/me', {
        method: 'POST',
        body: JSON.stringify(this.account),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
      }).then((r) => r.json()).then((r) => {
        if (r?.errors) {
          r.errors.forEach(e => {
            const $toast = useToast();
            $toast.error(e.msg, {
              position: 'top-right'
            });
          })
          throw new Error('Updating profile failed')
        } else {
          this.setAccount(r)
          closeModal()
        }
      }).catch((e) => {
        console.error(e)
        const $toast = useToast();
        $toast.error('Updating profile failed', {
            position: 'top-right'
        });
      }).finally(() => {
      })
    }
  }
}
</script>

<style scoped>

</style>
