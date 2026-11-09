<template>
  <header>
    <a href="/">Apps</a>
    <a href="/profile">Profile</a>
    <a v-if="account.privilegeDirectoryEnabled" href="/privileges">Who has access?</a>
    <a v-if="account.isAdmin" href="/admin">Admin panel</a>
  </header>

  <main>
    <div class="card card-wide">
      <p v-if="loading">Loading…</p>
      <p v-else-if="error">{{ error }}</p>
      <template v-else-if="!user">
        <h1>No such user</h1>
        <p>There is no user named {{ $route.params.username }}.</p>
      </template>
      <template v-else>
        <h1>{{ user.name || user.username }}</h1>
        <section class="profile-section">
          <div class="item">
            <div class="item-details">
              <p>Username: {{ user.username }}</p>
              <p v-if="user.type === 'service'">Service account</p>
              <p v-if="user.disabled">This account is disabled.</p>
              <p v-if="user.company">Company: {{ user.company }}</p>
              <p v-if="user.email"><a :href="`mailto:${user.email}`">{{ user.email }}</a></p>
              <p v-if="user.slackUrl"><a :href="user.slackUrl">Message on Slack</a></p>
              <p v-if="user.self"><a href="/profile">Edit your profile</a></p>
            </div>
          </div>
        </section>
        <section class="profile-section" v-if="user.roles.length">
          <div class="profile-section-header">
            <h2>Roles</h2>
          </div>
          <div class="item" v-for="role in user.roles" :key="role">
            <div class="item-details">
              <p><a :href="`/privileges/${encodeURIComponent(role)}`">{{ role }}</a></p>
            </div>
          </div>
        </section>
      </template>
    </div>
  </main>
</template>

<script>
import {mapActions, mapState} from 'pinia'
import {useAccountStore} from './stores/account'

export default {
  name: 'User',
  data() {
    return {user: null, loading: true, error: null}
  },
  computed: {
    ...mapState(useAccountStore, ['account']),
  },
  created() {
    fetch('/api/me').then(response => response.json()).then(account => this.setAccount(account)).catch(() => {})
    fetch(`/api/users/${encodeURIComponent(this.$route.params.username)}`).then(response => {
      if (response.status === 404) return null
      if (!response.ok) throw new Error('Unable to load user')
      return response.json()
    }).then(user => {
      this.user = user
    }).catch(() => {
      this.error = 'Unable to load this user. Please try again.'
    }).finally(() => {
      this.loading = false
    })
  },
  methods: {
    ...mapActions(useAccountStore, ['setAccount']),
  },
}
</script>
