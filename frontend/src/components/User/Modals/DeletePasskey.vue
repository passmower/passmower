<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Delete Passkey</h2>
      <XMark @click="closeModal" />
    </div>
    <p class="modal-description">
      Are you sure you want to delete the passkey "{{ passkey?.name }}"?
      You won't be able to use it to sign in anymore.
    </p>
    <button type="submit" class="danger" @click="confirmDelete" :disabled="deleting">
      {{ deleting ? 'Deleting...' : 'Delete Passkey' }}
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
  name: "DeletePasskey",
  components: {
    XMark
  },
  props: {
    passkey: Object
  },
  data() {
    return {
      deleting: false
    }
  },
  methods: {
    ...mapActions(useAccountStore, ['setPasskeys']),
    closeModal,
    async confirmDelete() {
      const $toast = useToast();
      this.deleting = true;

      try {
        const response = await fetch(`/api/passkeys/${encodeURIComponent(this.passkey.id)}`, {
          method: 'DELETE',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete passkey');
        }

        // Refresh passkeys list
        await this.refreshPasskeys();

        $toast.success('Passkey deleted', {
          position: 'top-right'
        });

        closeModal();

      } catch (error) {
        console.error('Failed to delete passkey:', error);
        $toast.error(error.message || 'Failed to delete passkey', {
          position: 'top-right'
        });
      } finally {
        this.deleting = false;
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
.modal-description {
  margin-bottom: 1em;
  line-height: 1.5;
}

button.danger {
  background: #dc3545;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
