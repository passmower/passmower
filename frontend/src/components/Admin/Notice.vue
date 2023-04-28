<template>
  <div class="notice">
      <Exclamation />
      <div>
          <p> {{ text }} </p>
          <button @click="buttonAction">{{ buttonText }}</button>
      </div>
  </div>
</template>

<script>
import Exclamation from "@/components/Icons/Exclamation.vue";

export default {
    name: "Notice",
    components: {Exclamation},
    props: {
        text: String,
        buttonText: String,
        buttonAction: Function
    },
}
</script>

<style scoped>

</style>