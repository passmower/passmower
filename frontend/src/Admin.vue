<template>
    <main>
        <div class="login-card">
            <h1>oidc-gateway admin</h1>
            <Accounts />
        </div>
    </main>
    <widget-container-modal />
</template>

<script>
import {container} from "jenesius-vue-modal";
import Accounts from "@/components/Admin/Accounts.vue";

export default {
    components: {
        Accounts,
        WidgetContainerModal: container,
    },
    data() {
        return {}
    },
    computed: {},
    created() {},
    methods: {}
}

</script>
