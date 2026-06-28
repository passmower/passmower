<template>
    <div class="profile-section">
        <div v-if="impersonationLink" class="notice">
            <Exclamation />
            <div>
                <p>
                    Impersonation link for <strong>{{ impersonationFor }}</strong>.
                    Open it in a <strong>private/incognito window</strong> or another device.
                    Opening it in this browser (with your existing session) will be refused,
                    to avoid mixing your and applications' cookies with the impersonated user's.
                </p>
                <p><a :href="impersonationLink">{{ impersonationLink }}</a></p>
                <button @click="copyImpersonationLink">Copy link</button>
                <button @click="impersonationLink = null">Dismiss</button>
            </div>
        </div>
        <div class="profile-section-header">
            <h2>Users</h2>
        </div>
        <div class="item" v-for="account in accounts" :key="account.accountId">
            <div class="item-details">
                <h3>{{ account.accountId }}</h3>
                <p>Name: {{ account.name }}</p>
                <p>Primary email: {{ account.email }}</p>
                <p>Conditions: {{ account.conditions.filter(c => c.status === 'True').map(c => c.type).join(', ') }}</p>
                <p v-if="account.groups.length">Groups: {{ account.groups.map(g => g.displayName).join(', ') }}</p>
            </div>
            <div class="item-actions">
                <Check v-if="!account.approved" @click="approve(account)" />
                <Info @click="editProfile(account)" />
                <Impersonate v-if="account.impersonationEnabled" @click="impersonate(account)" />
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
import Exclamation from "@/components/Icons/Exclamation.vue";
import EditProfile from "@/components/Admin/Modals/EditProfile.vue";
import {openModal} from "jenesius-vue-modal";
import {useAccountStore} from "@/stores/account";
import Check from "../Icons/Check.vue";

export default {
    name: "Accounts",
    components: {Check, Exclamation, Info, Impersonate},
    data() {
        return {
            impersonationLink: null,
            impersonationFor: null,
        }
    },
    created() {
        fetch('/admin/api/accounts').then((r) => r.json()).then((r) => {
            this.setAccounts(r.accounts)
        })
    },
    computed: {
        ...mapState(useAccountsStore, ['accounts']),
    },
    methods: {
        ...mapActions(useAccountStore, ['setAccount', 'originalAccount']),
        ...mapActions(useAccountsStore, ['setAccounts']),
        async editProfile(account) {
            this.setAccount(account)
            const modal = await openModal(EditProfile);
            modal.onclose = () => {
                this.setAccount(this.originalAccount)
            }
        },
        impersonate(account) {
            fetch('/admin/api/account/impersonation', {
                method: 'POST',
                body: JSON.stringify(account),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
            }).then((r) => r.json()).then((r) => {
                if (!r.impersonation) {
                    throw new Error('Impersonation link was not created')
                }
                this.impersonationLink = r.impersonation.link
                this.impersonationFor = r.impersonation.accountId
            }).catch((e) => {
                console.error(e)
                const $toast = useToast();
                $toast.error('Impersonating failed', {
                    position: 'top-right'
                });
            })
        },
        async copyImpersonationLink() {
            const $toast = useToast();
            try {
                await navigator.clipboard.writeText(this.impersonationLink)
                $toast.success('Link copied', {position: 'top-right'})
            } catch {
                $toast.error('Could not copy — select and copy manually', {position: 'top-right'})
            }
        },
        approve(account) {
              fetch('/admin/api/account/approve', {
                  method: 'POST',
                  body: JSON.stringify(account),
                  headers: {
                      'Accept': 'application/json',
                      'Content-Type': 'application/json'
                  },
              }).then((r) => r.json()).then((r) => {
                  this.setAccounts(r.accounts)
              }).catch((e) => {
                  console.error(e)
                  const $toast = useToast();
                  $toast.error('Approving user failed', {
                      position: 'top-right'
                  });
              })
        }
    }
}
</script>

<style scoped>

</style>
