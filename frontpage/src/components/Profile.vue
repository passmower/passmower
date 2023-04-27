<template>
    <div class="profile-section">
        <div class="profile-section-header">
            <h2>Profile</h2>
            <Pencil @click="editProfile"/>
        </div>
        <p><strong>Name: </strong> {{ account.name }}</p>
        <p v-if="account.company"><strong>Company: </strong> {{ account.company }}</p>
        <p><strong>Emails: </strong></p>
        <ul>
            <li v-for="email in account.emails">{{ email }}</li>
        </ul>
        <p><strong>Groups: </strong></p>
        <ul>
            <li v-for="group in account.groups">{{ group.displayName }}</li>
        </ul>
    </div>
</template>

<script>
import Pencil from "@/components/Icons/Pencil.vue";
import {mapActions, mapState, mapStores} from "pinia";
import {useAccountStore} from "@/stores/account";
import {openModal} from "jenesius-vue-modal";
import EditProfile from "@/components/Modals/EditProfile.vue";

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