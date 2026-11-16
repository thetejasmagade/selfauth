<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { describeError, useAuth } from "../auth/index.ts";

const auth = useAuth();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const done = ref(false);
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const result = await auth.client.register({ email: email.value, password: password.value });
    if (result.signedIn) {
      await auth.refresh();
      await router.replace("/notes");
    } else {
      done.value = true; // Same message whether or not the email was new (AUTHN-REG-005).
    }
  } catch (e) {
    error.value = describeError(e);
  } finally {
    busy.value = false;
    password.value = "";
  }
}
</script>

<template>
  <h1>Create account</h1>
  <p v-if="done" class="notice" data-testid="register-done">
    Check your inbox. If this address can be used, we have sent a link to finish setting up your
    account.
  </p>
  <form v-else @submit.prevent="submit">
    <label
      >Email <input v-model="email" name="email" type="email" autocomplete="email" required
    /></label>
    <label>
      Password
      <input
        v-model="password"
        name="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
      />
      <small>At least 12 characters. A few unrelated words work well.</small>
    </label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button :disabled="busy" type="submit">Create account</button>
  </form>
</template>
