<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Rename Passkey</h2>
      <XMark @click="closeModal" />
    </div>
    <label for="passkey-name">New name:</label>
    <input
      id="passkey-name"
      name="passkey-name"
      type="text"
      v-model="newName"
      placeholder="Enter new name"
      maxlength="50"
    />
    <button type="submit" @click="saveRename" :disabled="!newName.trim() || saving">
      {{ saving ? 'Saving...' : 'Save' }}
    </button>
  </div>
</template>

<script>
import { mapActions } from "pinia";
import { useAccountStore } from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import { closeModal } from "jenesius-vue-modal";
import { useToast } from "vue-toast-notification";

export default {
  name: "RenamePasskey",
  components: {
    XMark
  },
  props: {
    passkey: Object
  },
  data() {
    return {
      newName: this.passkey?.name || '',
      saving: false
    }
  },
  methods: {
    ...mapActions(useAccountStore, ['setPasskeys']),
    closeModal,
    async saveRename() {
      const $toast = useToast();
      this.saving = true;

      try {
        const response = await fetch(`/api/passkeys/${encodeURIComponent(this.passkey.id)}`, {
          method: 'PATCH',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: this.newName.trim()
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to rename passkey');
        }

        // Refresh passkeys list
        await this.refreshPasskeys();

        $toast.success('Passkey renamed', {
          position: 'top-right'
        });

        closeModal();

      } catch (error) {
        console.error('Failed to rename passkey:', error);
        $toast.error(error.message || 'Failed to rename passkey', {
          position: 'top-right'
        });
      } finally {
        this.saving = false;
      }
    },
    async refreshPasskeys() {
      try {
        const response = await fetch('/api/passkeys');
        const data = await response.json();
        this.setPasskeys(data.passkeys || []);
      } catch (error) {
        console.error('Failed to refresh passkeys:', error);
      }
    }
  }
}
</script>

<style scoped>
label {
  display: block;
  margin-bottom: 0.5em;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
