<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { describeError, useAuth, type SessionSummary } from "../auth/index.ts";
import shared from "../selfauth.config.json";

const minLength = shared.password.minLength;

const auth = useAuth();
const router = useRouter();
const sessions = ref<SessionSummary[]>([]);
const currentPassword = ref("");
const newPassword = ref("");
const message = ref("");
const error = ref("");

async function loadSessions() {
  sessions.value = await auth.client.listSessions();
}

async function changePassword() {
  message.value = error.value = "";
  try {
    await auth.client.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    message.value = "Password changed. Your other devices were signed out.";
    await Promise.all([auth.refresh(), loadSessions()]);
  } catch (e) {
    error.value = describeError(e);
  } finally {
    currentPassword.value = newPassword.value = "";
  }
}

async function revoke(id: string) {
  await auth.client.revokeSession(id);
  await loadSessions();
}

async function logoutEverywhere() {
  await auth.logoutAll();
  await router.push("/login");
}

onMounted(() => loadSessions().catch((e) => (error.value = describeError(e))));
</script>

<template>
  <h1>Account</h1>
  <section class="card">
    <p>
      <strong>{{ auth.state.user?.email }}</strong><br />
      Roles: {{ auth.state.user?.roles.join(", ") || "none" }}
    </p>
  </section>

  <section class="card">
    <h2>Change password</h2>
    <form @submit.prevent="changePassword">
      <label
        >Current password
        <input v-model="currentPassword" type="password" autocomplete="current-password" required
      /></label>
      <label
        >New password
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :minlength="minLength"
          required
      /></label>
      <button type="submit">Change password</button>
    </form>
  </section>

  <p v-if="message" class="notice">{{ message }}</p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>

  <section class="card">
    <h2>Signed-in devices</h2>
    <ul class="plain" data-testid="sessions">
      <li v-for="s in sessions" :key="s.id">
        {{ s.userAgent ?? "Unknown device" }} — since {{ new Date(s.createdAt).toLocaleString() }}
        <strong v-if="s.current">(this device)</strong>
        <button v-else class="secondary" @click="revoke(s.id)">Sign out</button>
      </li>
    </ul>
    <button class="secondary" data-testid="logout-all" @click="logoutEverywhere">
      Sign out everywhere
    </button>
  </section>
</template>
