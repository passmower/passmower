<template>
  <p v-if="attribution" class="geo-attribution">
    <small><a :href="attribution.url" rel="noreferrer noopener" target="_blank">{{ attribution.text }}</a></small>
  </p>
</template>

<script>
// The free GeoIP databases require attribution wherever their data is shown.
export default {
  name: 'GeoAttribution',
  props: {
    items: { type: Array, default: () => [] },
  },
  computed: {
    attribution() {
      return this.items.find((i) => i?.geo?.attribution)?.geo.attribution
    },
  },
}
</script>
