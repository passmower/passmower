<template>
  <span v-if="geo?.country" class="country-flag" :title="label">{{ flag }} {{ geo.country }}</span>
</template>

<script>
// Unknown-region code for addresses the GeoIP database cannot place (private,
// loopback, unallocated).
const UNKNOWN_COUNTRY = 'ZZ'

export default {
  name: 'CountryFlag',
  props: {
    geo: { type: Object, default: undefined },
  },
  computed: {
    // A flag emoji is the two regional-indicator symbols for the ISO code.
    flag() {
      const code = this.geo?.country
      if (!code || code === UNKNOWN_COUNTRY || !/^[A-Z]{2}$/.test(code)) return '🏳️'
      return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    },
    label() {
      return this.geo?.country === UNKNOWN_COUNTRY ? 'Unknown location' : this.geo?.country
    },
  },
}
</script>
