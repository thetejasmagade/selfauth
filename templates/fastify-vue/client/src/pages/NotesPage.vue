<script setup lang="ts">
import { onMounted, ref } from "vue";
import { describeError, useAuth } from "../auth/index.ts";

interface Note {
  id: string;
  text: string;
  ownerId: string;
}

const auth = useAuth();
const notes = ref<Note[]>([]);
const text = ref("");
const error = ref("");

async function load() {
  notes.value = (await auth.client.api<{ notes: Note[] }>("GET", "/api/notes")).notes;
}

async function add() {
  error.value = "";
  try {
    await auth.client.api("POST", "/api/notes", { text: text.value });
    text.value = "";
    await load();
  } catch (e) {
    error.value = describeError(e);
  }
}

onMounted(() => load().catch((e) => (error.value = describeError(e))));
</script>

<template>
  <h1>Notes</h1>
  <form class="card" @submit.prevent="add">
    <label>New note <textarea v-model="text" name="text" required maxlength="2000" /></label>
    <button type="submit">Add note</button>
  </form>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <ul class="plain" data-testid="notes">
    <li v-for="note in notes" :key="note.id" class="card">{{ note.text }}</li>
  </ul>
  <p v-if="notes.length === 0">No notes yet.</p>
</template>
