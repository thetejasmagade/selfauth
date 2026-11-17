<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { describeError, safeRedirect, useAuth } from "../../auth/index.ts";

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await auth.login(email.value, password.value);
    // Only same-origin paths are accepted from the URL (SEC-REDIRECT-001).
    await router.replace(safeRedirect(route.query["redirect"], "/notes"));
  } catch (e) {
    error.value = describeError(e);
  } finally {
    busy.value = false;
    password.value = "";
  }
}
</script>

<template>
  <h1>Sign in</h1>
  <form @submit.prevent="submit">
    <label
      >Email <input v-model="email" name="email" type="email" autocomplete="username" required
    /></label>
    <label
      >Password
      <input
        v-model="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
    /></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button :disabled="busy" type="submit">Sign in</button>
  </form>
  <p><RouterLink to="/forgot-password">Forgot your password?</RouterLink></p>
  <p>No account? <RouterLink to="/register">Create one</RouterLink></p>
</template>
