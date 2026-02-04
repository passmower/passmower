<template>
  <div class="modal">
    <div class="modal-header">
      <h2>Register a Passkey</h2>
      <XMark @click="closeModal" />
    </div>
    <template v-if="!registering && !success">
      <p class="modal-description">
        Passkeys let you sign in quickly and securely using your device's built-in authentication
        (fingerprint, face recognition, or PIN).
      </p>
      <label for="passkey-name">Passkey name:</label>
      <input
        id="passkey-name"
        name="passkey-name"
        type="text"
        v-model="passkeyName"
        placeholder="e.g., MacBook Touch ID"
        maxlength="50"
      />
      <button type="submit" @click="startRegistration" :disabled="!passkeyName.trim()">
        Register Passkey
      </button>
    </template>
    <template v-else-if="registering">
      <p class="modal-description">
        Please follow your browser's prompts to register your passkey...
      </p>
    </template>
    <template v-else-if="success">
      <p class="modal-description success">
        Passkey registered successfully!
      </p>
      <button type="submit" @click="closeModal">Done</button>
    </template>
  </div>
</template>

<script>
import { mapActions } from "pinia";
import { useAccountStore } from "@/stores/account";
import XMark from "@/components/Icons/XMark.vue";
import { closeModal } from "jenesius-vue-modal";
import { useToast } from "vue-toast-notification";

export default {
  name: "RegisterPasskey",
  components: {
    XMark
  },
  data() {
    return {
      passkeyName: '',
      registering: false,
      success: false
    }
  },
  methods: {
    ...mapActions(useAccountStore, ['setPasskeys']),
    closeModal,
    async startRegistration() {
      const $toast = useToast();
      this.registering = true;

      try {
        // Check if WebAuthn is supported
        if (!window.PublicKeyCredential) {
          throw new Error('WebAuthn is not supported in this browser');
        }

        // Start registration - get options from server
        const startResponse = await fetch('/api/passkeys/register/start', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });

        if (!startResponse.ok) {
          const error = await startResponse.json();
          throw new Error(error.error || 'Failed to start registration');
        }

        const options = await startResponse.json();

        // Convert base64url strings to ArrayBuffers
        options.challenge = this.base64urlToBuffer(options.challenge);
        options.user.id = this.base64urlToBuffer(options.user.id);
        if (options.excludeCredentials) {
          options.excludeCredentials = options.excludeCredentials.map(cred => ({
            ...cred,
            id: this.base64urlToBuffer(cred.id)
          }));
        }

        // Create credential
        const credential = await navigator.credentials.create({
          publicKey: options
        });

        // Prepare response for server
        const response = {
          id: credential.id,
          rawId: this.bufferToBase64url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: this.bufferToBase64url(credential.response.clientDataJSON),
            attestationObject: this.bufferToBase64url(credential.response.attestationObject),
          }
        };

        // Add transports if available
        if (credential.response.getTransports) {
          response.response.transports = credential.response.getTransports();
        }

        // Complete registration
        const finishResponse = await fetch('/api/passkeys/register/finish', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            response: response,
            name: this.passkeyName.trim()
          })
        });

        if (!finishResponse.ok) {
          const error = await finishResponse.json();
          throw new Error(error.error || 'Failed to complete registration');
        }

        const result = await finishResponse.json();

        if (result.verified) {
          this.registering = false;
          this.success = true;
          // Refresh passkeys list
          await this.refreshPasskeys();
          $toast.success('Passkey registered successfully', {
            position: 'top-right'
          });
          // Auto-close after a brief moment
          setTimeout(() => closeModal(), 1000);
        } else {
          throw new Error('Verification failed');
        }

      } catch (error) {
        console.error('Passkey registration error:', error);
        this.registering = false;

        let message = 'Failed to register passkey';
        if (error.name === 'NotAllowedError') {
          message = 'Registration was cancelled or timed out';
        } else if (error.name === 'InvalidStateError') {
          message = 'This passkey is already registered';
        } else if (error.message) {
          message = error.message;
        }

        $toast.error(message, {
          position: 'top-right'
        });
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
    },
    base64urlToBuffer(base64url) {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(base64 + padding);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    },
    bufferToBase64url(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
  }
}
</script>

<style scoped>
.modal-description {
  margin-bottom: 1em;
  line-height: 1.5;
}

.modal-description.success {
  color: hsla(160, 100%, 37%, 1);
  font-weight: 500;
}

label {
  display: block;
  margin-bottom: 0.5em;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
