<template>
  <div class="profile-section">
    <div class="profile-section-header no-flex">
      <h2>Invite new user</h2>
      <p>You can also create users by creating OIDCGWUser CRDs</p>
    </div>
    <template v-if="requireUsername">
      <label for="username">Username: </label>
      <input name="username" type="text" v-model="username" placeholder="oidc-gateway is configured to require custom username" />
    </template>
    <label for="email">Email: </label>
    <input name="email" type="email" v-model="email" required />
    <button type="submit" @click="inviteUser">Invite</button>
  </div>
</template>

<script>
import {useToast} from "vue-toast-notification";
import {mapActions, mapState} from "pinia";
import {useAccountsStore} from "../../stores/accounts";
import {userAdminStore} from "../../stores/admin";

export default {
  name: "InviteUser",
  data() {
    return {
      email: null,
      username: null,
    }
  },
  computed: {
    ...mapState(userAdminStore, ['requireUsername']),
  },
  methods: {
    ...mapActions(useAccountsStore, ['setAccounts']),
    inviteUser() {
      fetch('/admin/api/account/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: this.email,
          username: this.username
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
          if (message?.errors) {
            message.errors.forEach(e => {
              const $toast = useToast();
              $toast.error(e.msg, {
                position: 'top-right'
              });
            })
          }
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
