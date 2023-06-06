<template>
    <div class="profile-section">
        <div class="profile-section-header">
            <h2>Available apps</h2>
        </div>
        <div class="item" v-for="app in apps">
         <div class="item-details">
          <h3>{{ app.name }}</h3>
          <a :href="app.url" rel="noreferrer noopener" target="_blank">{{ app.url }}</a>
         </div>
       </div>
    </div>
</template>

<script>
import {mapState, mapStores} from "pinia";
import {useAppsStore} from "../../stores/apps";
export default {
    name: "Apps",
    computed: {
        ...mapStores(useAppsStore),
        ...mapState(useAppsStore, ['apps']),
    },
    methods: {}
}
</script>

<style scoped>

</style>
