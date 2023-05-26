<template>
    <main>
        <div class="card card-wide">
            <h1>oidc-gateway admin</h1>
            <InviteUser />
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

export default {
    components: {
      InviteUser,
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
        })
    },
    methods: {
        ...mapActions(userAdminStore, ['setGroupPrefix']),
    }
}

</script>
