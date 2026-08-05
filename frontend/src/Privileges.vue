<template>
  <header>
    <a href="/">Apps</a>
    <a href="/profile">Profile</a>
    <a v-if="account.isAdmin" href="/admin">Admin panel</a>
  </header>

  <main>
    <div class="card card-wide">
      <h1>Who has access?</h1>
      <p>Contact one of the people listed below when you need help with a role or its resources.</p>
      <p v-if="loading">Loading roles…</p>
      <p v-else-if="error">{{ error }}</p>
      <p v-else-if="notFound">This role is not listed.</p>
      <p v-else-if="!roles.length">No roles are published.</p>
      <section class="profile-section" v-for="role in roles" :key="role.group">
        <div class="profile-section-header">
          <h2><a :href="roleUrl(role.group)">{{ role.group }}</a></h2>
        </div>
        <p v-if="!role.members.length">No current members.</p>
        <div class="item" v-for="member in role.members" :key="member.username">
          <div class="item-details">
            <h3>{{ member.name || member.username }}</h3>
            <p v-if="member.name && member.name !== member.username">Username: {{ member.username }}</p>
            <p v-if="member.email"><a :href="`mailto:${member.email}`">{{ member.email }}</a></p>
            <p v-if="member.slackUrl"><a :href="member.slackUrl">Message on Slack</a></p>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script>
import {mapActions, mapState} from 'pinia'
import {useAccountStore} from './stores/account'

export default {
  name: 'Privileges',
  data() {
    return {roles: [], loading: true, notFound: false, error: null}
  },
  computed: {
    ...mapState(useAccountStore, ['account']),
  },
  created() {
    fetch('/api/me').then(response => response.json()).then(account => this.setAccount(account)).catch(() => {})
    const group = this.$route.params.group
    const query = group ? `?group=${encodeURIComponent(group)}` : ''
    fetch(`/api/privileges${query}`).then(response => {
      if (response.status === 404) {
        this.notFound = true
        return {roles: []}
      }
      if (!response.ok) throw new Error('Unable to load privilege directory')
      return response.json()
    }).then(result => {
      this.roles = result.roles
    }).catch(() => {
      this.error = 'Unable to load the privilege directory. Please try again.'
    }).finally(() => {
      this.loading = false
    })
  },
  methods: {
    ...mapActions(useAccountStore, ['setAccount']),
    roleUrl(group) {
      return `/privileges/${encodeURIComponent(group)}`
    },
  },
}
</script>
