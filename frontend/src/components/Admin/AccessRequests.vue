<template>
    <div class="profile-section" v-if="requests.length">
        <div class="profile-section-header">
            <h2>Access requests</h2>
        </div>
        <div class="item" v-for="request in requests" :key="request.id">
            <div class="item-details">
                <h3>{{ request.accountId }} → {{ request.clientId }}</h3>
                <p>
                    Requested <time :datetime="request.lastRequestedAt">{{ formatDate(request.lastRequestedAt) }}</time>
                    <span v-if="request.count > 1"> — {{ request.count }} times since {{ formatDate(request.firstRequestedAt) }}</span>
                </p>
                <p v-if="request.allowedGroups.length">
                    Grant by adding the user to one of the allowed groups:
                    <strong>{{ request.allowedGroups.join(', ') }}</strong>
                </p>
            </div>
            <div class="item-actions">
                <button @click="dismiss(request)">Dismiss</button>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: "AccessRequests",
    data() {
        return {
            requests: [],
        }
    },
    created() {
        this.refresh()
    },
    methods: {
        refresh() {
            fetch('/admin/api/access-requests').then((r) => r.json()).then((r) => {
                this.requests = r.requests ?? []
            })
        },
        formatDate(value) {
            if (!value) return 'Never'
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(new Date(value))
        },
        async dismiss(request) {
            await fetch('/admin/api/access-requests/dismiss', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: request.id}),
            })
            this.refresh()
        },
    },
}
</script>
