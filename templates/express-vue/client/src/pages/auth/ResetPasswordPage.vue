<script setup lang="ts">
import { onMounted, ref } from "vue";
import { describeError, takeTokenFromFragment, useAuth } from "../../auth/index.ts";

const auth = useAuth();
const token = ref<string | null>(null);
const password = ref("");
const error = ref("");
const done = ref(false);

// Kept in memory only; removed from the URL immediately (SEC-TOKEN-005).
onMounted(() => {
  token.value = takeTokenFromFragment();
  if (!token.value) error.value = "This link is invalid or has expired. Request a new one.";
});

async function submit() {
  if (!token.value) return;
  error.value = "";
  try {
    await auth.client.resetPassword({ token: token.value, newPassword: password.value });
    token.value = null;
    done.value = true;
    auth.markSignedOut(); // all sessions were revoked (AUTHN-RESET-010)
  } catch (e) {
    error.value = describeError(e);
  } finally {
    password.value = "";
  }
}
</script>

<template>
  <h1>Choose a new password</h1>
  <p v-if="done" class="notice" data-testid="reset-done">
    Your password was changed and every device was signed out.
    <RouterLink to="/login">Sign in</RouterLink>
  </p>
  <form v-else-if="token" @submit.prevent="submit">
    <label
      >New password
      <input
        v-model="password"
        name="password"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
    /></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button type="submit">Change password</button>
  </form>
  <p v-else class="error" role="alert">
    {{ error }} <RouterLink to="/forgot-password">Request a new link</RouterLink>
  </p>
</template>
