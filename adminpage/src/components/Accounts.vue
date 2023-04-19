<template>
    <div class="profile-section">
        <div class="profile-section-header">
            <h2>Users</h2>
        </div>
        <div class="item" v-for="account in accounts">
            <div class="item-details">
                <h3>{{ account.accountId }}</h3>
                <p>Name: {{ account.profile?.name }}</p>
                <p>(First) email: {{ account.emails[0] }}</p>
            </div>
            <div class="item-actions">
                <Info />
                <Impersonate />
            </div>
        </div>
    </div>
</template>

<script>
import {mapActions, mapState} from "pinia";
import {useAccountsStore} from "@/stores/accounts";
import Impersonate from "@/components/Icons/Impersonate.vue";
import Info from "@/components/Icons/Info.vue";

export default {
    name: "Accounts",
    components: {Info, Impersonate},
    created() {
        fetch('/admin/api/accounts').then((r) => r.json()).then((r) => {
            this.setAccounts(r.accounts)
        }).then(() => {
            console.log(this.accounts)
        })
    },
    computed: {
        ...mapState(useAccountsStore, ['accounts']),
    },
    methods: {
        ...mapActions(useAccountsStore, ['setAccounts']),
    }
}
</script>

<style scoped>

</style>