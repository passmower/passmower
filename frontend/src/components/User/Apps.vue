<template>
    <div class="profile-section">
        <div class="profile-section-header">
            <h2>Available apps</h2>
        </div>
        <div class="item" v-for="app in apps" :key="app.name">
         <div class="item-details">
          <h3>{{ app.name }}</h3>
          <a :href="app.url" rel="noreferrer noopener" target="_blank">{{ app.url }}</a>
          <!-- Server renders the kubernetes.io/description annotation to sanitized HTML -->
          <div v-if="app.description" class="app-description" v-html="app.description"></div>
          <p v-if="app.metadata">Last authorized at {{ app.metadata.ts }} on {{ app.metadata.browser }} ({{ app.metadata.os }}) from {{ app.metadata.ip }} <CountryFlag :geo="app.metadata.geo" /></p>
         </div>
       </div>
        <GeoAttribution :items="apps.map((a) => a.metadata)" />
    </div>
</template>

<script>
import {mapState, mapStores} from "pinia";
import {useAppsStore} from "../../stores/apps";
import CountryFlag from "@/components/CountryFlag.vue";
import GeoAttribution from "@/components/GeoAttribution.vue";
export default {
    name: "Apps",
    components: {CountryFlag, GeoAttribution},
    computed: {
        ...mapStores(useAppsStore),
        ...mapState(useAppsStore, ['apps']),
    },
    methods: {}
}
</script>

<style scoped>

</style>
