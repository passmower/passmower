<template>
    <div class="profile-section">
        <div class="profile-section-header">
            <h2>Profile</h2>
            <Pencil @click="editProfile"/>
        </div>
        <p><strong>Name: </strong> {{ account.name }}</p>
        <p v-if="account.company"><strong>Company: </strong> {{ account.company }}</p>
        <p><strong>Primary email: </strong> {{ account.email }}</p>
        <p><strong>Emails: </strong></p>
        <ul>
            <li v-for="email in account.emails">{{ email }}</li>
        </ul>
        <p><strong>Phones: </strong></p>
        <ul>
          <li v-for="phone in account.phones">{{ phone }}</li>
        </ul>
        <p><strong>Groups: </strong></p>
        <ul>
            <li v-for="group in account.groups">{{ group.displayName }}</li>
        </ul>
        <br/>
        <p v-if="account.tos_accepted_at"><a target="_blank" href="/terms-of-service">Terms of Service</a> accepted at {{account.tos_accepted_at}}</p>
        <p v-else>Terms of Service not accepted</p>
    </div>
</template>

<script>
import Pencil from "@/components/Icons/Pencil.vue";
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import {openModal} from "jenesius-vue-modal";
import EditProfile from "@/components/User/Modals/EditProfile.vue";
export default {
    name: "Profile",
    components: {
        Pencil
    },
    computed: {
        ...mapStores(useAccountStore),
        ...mapState(useAccountStore, ['account', 'originalAccount']),
    },
    methods: {
        ...mapActions(useAccountStore, ['setAccount']),
        async editProfile(e) {
            const modal = await openModal(EditProfile);
            modal.onclose = () => {
                this.setAccount(this.originalAccount)
            }
        }
    }
}
</script>

<style scoped>

</style>
