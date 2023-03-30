<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Edit profile</h2>
      <XMark @click="closeModal" />
    </div>
    <label for="name">Name: </label>
    <input name="name" type="text" v-model="account.name" />
    <label for="name">Company: </label>
    <input name="name" type="text" v-model="account.company" />
    <button type="submit" @click="saveAccount">Save changes</button>
  </div>
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import {closeModal} from "jenesius-vue-modal"

export default {
  name: "EditProfile",
  components: {
    XMark
  },
  computed: {
    ...mapStores(useAccountStore),
    ...mapState(useAccountStore, ['account']),
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
        this.setAccount(r)
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