<template>
    <main>
        <div class="card card-wide">
            <h1>oidc-gateway admin</h1>
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

export default {
    components: {
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
