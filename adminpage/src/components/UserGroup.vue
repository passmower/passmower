<template>
    <div class="input-box">
        <label>{{ group.prefix }}:</label>
        <input type="text" :value="group.name" @change="(e) => $emit('changeName', e.target.value)" :disabled="!group.editable" />
        <XMark v-if="group.editable" @click="$emit('remove')" />
    </div>
</template>

<script>
import XMark from "@/components/Icons/XMark.vue";

export default {
    name: "UserGroup",
    components: {XMark},
    props: {
        group: Object
    }
}
</script>

<style scoped>

</style>