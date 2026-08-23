<template>
  <div class="profile-section">
    <div class="profile-section-header">
      <h2>Passkeys</h2>
      <Plus @click="registerPasskey" />
    </div>
    <p v-if="passkeys.length === 0" class="no-passkeys">
      No passkeys registered. Add a passkey for faster, more secure sign-in.
    </p>
    <div class="item" v-for="passkey in passkeys" :key="passkey.id">
      <div class="item-details">
        <h3>
          <Key class="passkey-icon" />
          {{ passkey.name }}
        </h3>
        <p>Added: {{ formatDate(passkey.createdAt) }}</p>
      </div>
      <div class="item-actions">
        <Pencil @click="renamePasskey(passkey)" />
        <XMark @click="deletePasskey(passkey)" />
      </div>
    </div>
  </div>
</template>

<script>
import { mapState, mapActions } from "pinia";
import { useAccountStore } from "@/stores/account";
import { openModal } from "jenesius-vue-modal";
import Plus from "@/components/Icons/Plus.vue";
import Key from "@/components/Icons/Key.vue";
import Pencil from "@/components/Icons/Pencil.vue";
import XMark from "@/components/Icons/XMark.vue";
import RegisterPasskey from "@/components/User/Modals/RegisterPasskey.vue";
import RenamePasskey from "@/components/User/Modals/RenamePasskey.vue";
import DeletePasskey from "@/components/User/Modals/DeletePasskey.vue";

export default {
  name: "Passkeys",
  components: {
    Plus,
    Key,
    Pencil,
    XMark
  },
  computed: {
    ...mapState(useAccountStore, ['passkeys']),
  },
  methods: {
    ...mapActions(useAccountStore, ['setPasskeys']),
    formatDate(dateString) {
      if (!dateString) return 'Unknown';
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },
    async registerPasskey() {
      await openModal(RegisterPasskey);
    },
    async renamePasskey(passkey) {
      await openModal(RenamePasskey, {
        passkey: passkey
      });
    },
    async deletePasskey(passkey) {
      await openModal(DeletePasskey, {
        passkey: passkey
      });
    }
  }
}
</script>

<style scoped>
.no-passkeys {
  color: var(--vt-c-text-light-2);
  font-style: italic;
  padding-bottom: 1em;
}

.passkey-icon {
  display: inline-block;
  height: 14px;
  width: 14px;
  margin-right: 0.5em;
  vertical-align: middle;
}

.item-actions {
  display: flex;
  gap: 0.5em;
}

.item-actions svg {
  cursor: pointer;
}
</style>
