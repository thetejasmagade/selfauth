<script setup lang="ts">
import { useAuth } from "../auth/index.ts";
const auth = useAuth();
</script>

<template>
  <h1>SelfAuth Vue playground</h1>
  <p v-if="auth.isAuthenticated">
    Signed in. Go to your <RouterLink to="/notes">notes</RouterLink>.
  </p>
  <p v-else>
    <RouterLink to="/login">Sign in</RouterLink> or
    <RouterLink to="/register">create an account</RouterLink>.
  </p>
</template>
