<template>
    <div class="modal">
        <div class="modal-header">
            <h2>Edit profile</h2>
            <XMark @click="closeModal"/>
        </div>
        <label for="name">Name: </label>
        <input name="name" type="text" v-model="account.name"/>
        <label for="name">Company: </label>
        <input name="name" type="text" v-model="account.company"/>
        <p><strong>Emails: </strong></p>
        <ul>
            <li v-for="email in account.emails">{{ email }}</li>
        </ul>
        <div style="display: flex">
            <label for="groups">Groups: </label>
            <Plus @click="addGroup" />
        </div>
        <template v-for="(group, index) in account.groups">
            <UserGroup :group="account.groups[index]" @change-name="(name) => changeGroupName(index, name)" @remove="removeGroup(index)" />
        </template>
        <br />
        <button type="submit" @click="saveAccount">Save changes</button>
    </div>
</template>

<script>
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import {closeModal} from "jenesius-vue-modal"
import {useToast} from "vue-toast-notification";
import {useAccountsStore} from "@/stores/accounts";
import Plus from "@/components/Icons/Plus.vue";
import UserGroup from "@/components/Admin/UserGroup.vue";

export default {
    name: "EditProfile",
    components: {
        UserGroup,
        Plus,
        XMark
    },
    computed: {
        ...mapStores(useAccountStore),
        ...mapState(useAccountStore, ['account']),
    },
    methods: {
        ...mapActions(useAccountsStore, ['setAccounts']),
        closeModal,
        addGroup() {
           this.account.groups.push({
               prefix: this.account.groupPrefix,
               name: null,
               editable: true
           })
        },
        changeGroupName(index, name) {
            this.account.groups[index].name = name
        },
        removeGroup(index) {
            this.account.groups.splice(index, 1)
        },
        saveAccount() {
            fetch('/admin/api/accounts/' + this.account.accountId, {
                method: 'POST',
                body: JSON.stringify(this.account),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
            }).then((r) => r.json()).then((r) => {
                this.setAccounts(r.accounts)
            }).catch((e) => {
                console.error(e)
                const $toast = useToast();
                $toast.error('Updating profile failed', {
                    position: 'top-right'
                });
            }).finally(() => {
                closeModal()
            })
        }
    }
}
</script>

<style scoped>

</style>