<template>
    <main>
        <div class="card card-wide">
            <h1>Passmower admin</h1>
            <InviteUser />
            <Incidents />
            <Accounts />
        </div>
    </main>
    <widget-container-modal />
</template>

<script>
import {container} from "jenesius-vue-modal";
import Accounts from "@/components/Admin/Accounts.vue";
import {mapActions} from "pinia";
import {userAdminStore} from "./stores/admin";
import InviteUser from "./components/Admin/InviteUser.vue";
import Incidents from "./components/Admin/Incidents.vue";

export default {
    components: {
      InviteUser,
        Incidents,
        Accounts,
        WidgetContainerModal: container,
    },
    data() {
        return {}
    },
    computed: {},
    created() {
        fetch('/admin/api/metadata').then((r) => r.json()).then((r) => {
            this.setGroupPrefix(r.groupPrefix)
            this.setRequireUsername(r.requireUsername)
            this.setEmailEnabled(r.emailEnabled)
            this.setDisableEditing(r.disableEditing)
            this.setDisableEditingText(r.disableEditingText)
        })
    },
    methods: {
        ...mapActions(userAdminStore, ['setGroupPrefix', 'setRequireUsername', 'setEmailEnabled', 'setDisableEditing', 'setDisableEditingText']),
    }
}

</script>
