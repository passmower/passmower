<template>
  <div class="profile-section">
    <div class="profile-section-header">
      <h2>Invite new user</h2>
    </div>
    <label for="email">Email: </label>
    <input name="email" type="email" v-model="email" required />
    <button type="submit" @click="inviteUser">Invite</button>
  </div>
</template>

<script>
import {useToast} from "vue-toast-notification";
import {mapActions} from "pinia";
import {useAccountsStore} from "../../stores/accounts";

export default {
  name: "InviteUser",
  data() {
    return {
      email: null,
    }
  },
  methods: {
    ...mapActions(useAccountsStore, ['setAccounts']),
    inviteUser() {
      fetch('/admin/api/account/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: this.email
        }),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
      }).then(async response => {
        if (!response.ok) {
          let message
          try {
            message = await response.json()
          } catch (e) {}
          message = message?.message ?? 'Inviting user failed'
          throw new Error(message)
        }
        return response.json()
      }).then((r) => {
        const $toast = useToast();
        $toast.success('User successfully invited', {
          position: 'top-right'
        });
        this.setAccounts(r.accounts)
      }).catch((e) => {
        console.error(e)
        const $toast = useToast();
        $toast.error(e.message, {
          position: 'top-right'
        });
      })
    }
  }
}
</script>
