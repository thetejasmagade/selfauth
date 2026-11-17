<script setup lang="ts">
import { ref } from "vue";
import { describeError, useAuth } from "../../auth/index.ts";

const auth = useAuth();
const email = ref("");
const sent = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  try {
    await auth.client.requestPasswordReset(email.value);
    sent.value = true; // Same message for every address (AUTHN-RESET-001).
  } catch (e) {
    error.value = describeError(e);
  }
}
</script>

<template>
  <h1>Reset password</h1>
  <p v-if="sent" class="notice" data-testid="reset-sent">
    If an account exists for that address, we have sent a link to reset the password.
  </p>
  <form v-else @submit.prevent="submit">
    <label
      >Email <input v-model="email" name="email" type="email" autocomplete="email" required
    /></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button type="submit">Send reset link</button>
  </form>
</template>
