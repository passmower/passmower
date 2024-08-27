<template>
    <div class="modal">
        <div class="modal-header">
            <h2 v-if="disableEditing">View profile</h2>
            <h2 v-else>Edit profile</h2>
            <XMark @click="closeModal"/>
        </div>
        <label for="name">Name: </label>
        <input name="name" type="text" v-model="account.name" :disabled="disableEditing" />
        <label for="name">Company: </label>
        <input name="name" type="text" v-model="account.company" :disabled="disableEditing" />
        <p><strong>Emails: </strong></p>
        <ul>
            <li v-for="email in account.emails" v-bind:key="email">
              <span v-if="account.email === email">
                {{ email }}
              </span>
              <i v-else>
                {{ email }}
              </i>
            </li>
        </ul>
        <div style="display: flex">
            <label for="groups">Groups: </label>
            <Plus v-if="!disableEditing" @click="addGroup" />
        </div>
        <template v-for="(group, index) in account.groups" v-bind:key="index">
            <UserGroup :group="account.groups[index]" @change-name="(name) => changeGroupName(index, name)" @remove="removeGroup(index)" />
        </template>
        <br />
        <button v-if="!disableEditing" type="submit" @click="saveAccount">Save changes</button>
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
import {userAdminStore} from "../../../stores/admin";

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
        ...mapState(userAdminStore, ['groupPrefix', 'disableEditing', 'disableEditingText']),
    },
    methods: {
        ...mapActions(useAccountsStore, ['setAccounts']),
        closeModal,
        addGroup() {
           this.account.groups.push({
               prefix: this.groupPrefix,
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
            fetch('/admin/api/accounts', {
                method: 'POST',
                body: JSON.stringify(this.account),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
            }).then((r) => r.json()).then((r) => {
              if (r?.errors) {
                r.errors.forEach(e => {
                  const $toast = useToast();
                  $toast.error(e.msg, {
                    position: 'top-right'
                  });
                })
                throw new Error('Updating profile failed')
              } else {
                this.setAccounts(r.accounts)
                closeModal()
              }
            }).catch((e) => {
                console.error(e)
                const $toast = useToast();
                $toast.error('Updating profile failed', {
                    position: 'top-right'
                });
            }).finally(() => {
            })
        }
    }
}
</script>

<style scoped>

</style>
