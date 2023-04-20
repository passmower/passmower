<template>
    <div class="profile-section">
        <Notice
            v-if="impersonation"
            :text="`You are now impersonating ${impersonation.accountId}. Your own session cookie has been removed. Navigate to desired client service and initiate login - login prompt will enable you to act as impersonated user.`"
            button-text="End impersonation"
            :button-action="endImpersonation"
        />
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
                <Impersonate @click="impersonate(account)" />
            </div>
        </div>
    </div>
</template>

<script>
import {mapActions, mapState} from "pinia";
import {useAccountsStore} from "@/stores/accounts";
import Impersonate from "@/components/Icons/Impersonate.vue";
import Info from "@/components/Icons/Info.vue";
import {useToast} from "vue-toast-notification";
import {useImpersonationStore} from "@/stores/impersonation";
import Notice from "@/components/Notice.vue";

export default {
    name: "Accounts",
    components: {Notice, Info, Impersonate},
    created() {
        fetch('/admin/api/account/impersonation').then((r) => r.json()).then((r) => {
            this.setImpersonation(r.impersonation)
        })

        fetch('/admin/api/accounts').then((r) => r.json()).then((r) => {
            this.setAccounts(r.accounts)
        })
    },
    computed: {
        ...mapState(useAccountsStore, ['accounts']),
        ...mapState(useImpersonationStore, ['impersonation']),
    },
    methods: {
        ...mapActions(useAccountsStore, ['setAccounts']),
        ...mapActions(useImpersonationStore, ['setImpersonation']),
        impersonate(account) {
            fetch('/admin/api/account/impersonation', {
                method: 'POST',
                body: JSON.stringify(account),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
            }).then((r) => r.json()).then((r) => {
                this.setImpersonation(r.impersonation)
            }).catch((e) => {
                console.error(e)
                const $toast = useToast();
                $toast.error('Impersonating failed', {
                    position: 'top-right'
                });
            })
        },
        endImpersonation() {
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
        }
    }
}
</script>

<style scoped>

</style>