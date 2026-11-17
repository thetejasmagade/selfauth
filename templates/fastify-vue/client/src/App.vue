<script setup lang="ts">
import { useRouter } from "vue-router";
import { Can, useAuth } from "./auth/index.ts";

const auth = useAuth();
const router = useRouter();

async function logout() {
  await auth.logout();
  await router.push("/login");
}
</script>

<template>
  <header>
    <RouterLink to="/"><strong>SelfAuth</strong></RouterLink>
    <template v-if="auth.isAuthenticated">
      <RouterLink to="/notes">Notes</RouterLink>
      <RouterLink to="/account">Account</RouterLink>
      <Can permission="notes.view_any"><span data-testid="support-badge">Support</span></Can>
    </template>
    <span v-if="auth.state.status === 'loading'">Loading…</span>
    <template v-else-if="auth.isAuthenticated">
      <span data-testid="current-email">{{ auth.state.user?.email }}</span>
      <button data-testid="logout" @click="logout">Sign out</button>
    </template>
    <template v-else>
      <RouterLink to="/login">Sign in</RouterLink>
      <RouterLink to="/register">Create account</RouterLink>
    </template>
  </header>
  <main>
    <p v-if="auth.state.status === 'loading'">Checking your session…</p>
    <RouterView v-else />
  </main>
</template>
