<script setup lang="ts">
import { onMounted, ref } from "vue";
import { describeError, takeTokenFromFragment, useAuth } from "../../auth/index.ts";

const auth = useAuth();
const status = ref<"working" | "verified" | "failed">("working");
const error = ref("");

onMounted(async () => {
  // Token is read from the fragment and removed from the URL at once (SEC-TOKEN-005).
  const token = takeTokenFromFragment();
  if (!token) {
    status.value = "failed";
    error.value = "This link is invalid or has expired. Request a new one.";
    return;
  }
  try {
    await auth.client.verifyEmail(token);
    status.value = "verified";
  } catch (e) {
    status.value = "failed";
    error.value = describeError(e);
  }
});
</script>

<template>
  <h1>Verify email</h1>
  <p v-if="status === 'working'">Verifying…</p>
  <p v-else-if="status === 'verified'" data-testid="verified">
    Your email address is verified. <RouterLink to="/login">Sign in</RouterLink>
  </p>
  <p v-else role="alert">{{ error }}</p>
</template>
