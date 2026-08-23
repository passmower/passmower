<template>
    <div class="profile-section" v-if="incidents.length">
        <div class="profile-section-header">
            <h2>Recent access incidents</h2>
        </div>
        <div class="item" v-for="incident in incidents" :key="incident.id">
            <div class="item-details">
                <h3>{{ incident.accountId || 'anonymous' }} → {{ incident.clientId }}</h3>
                <p>
                    {{ describeFailure(incident.failure) }}
                    via {{ incident.source === 'forward-auth' ? 'forward auth' : 'OIDC login' }}
                </p>
                <p>
                    Last seen <time :datetime="incident.lastSeenAt">{{ formatDate(incident.lastSeenAt) }}</time>
                    <span v-if="incident.count > 1"> — {{ incident.count }} attempts since {{ formatDate(incident.firstSeenAt) }}</span>
                    <span v-if="incident.sourceIp"> from {{ incident.sourceIp }}</span>
                </p>
                <p v-if="incident.failure === 'client_access_required' && incident.allowedGroups.length">
                    Suggested fix: add the user to one of the allowed groups:
                    <strong>{{ incident.allowedGroups.join(', ') }}</strong>
                </p>
                <p v-else-if="incident.failure === 'client_access_required' && incident.allowedUsers.length">
                    Suggested fix: add the user to the client's allowed users list.
                </p>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: "Incidents",
    data() {
        return {
            incidents: [],
        }
    },
    created() {
        fetch('/admin/api/incidents').then((r) => r.json()).then((r) => {
            this.incidents = r.incidents ?? []
        })
    },
    methods: {
        formatDate(value) {
            if (!value) return 'Never'
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(new Date(value))
        },
        describeFailure(failure) {
            const descriptions = {
                client_access_required: 'Not a member of an allowed group',
                approval_required: 'Account is not approved',
                name_required: 'Account has no name set',
                tos_required: 'Terms of Service not accepted',
                account_banned: 'Account is banned',
                account_missing: 'Account no longer exists',
                account_type_not_login_capable: 'Account type cannot sign in',
            }
            return descriptions[failure] ?? failure
        },
    },
}
</script>
