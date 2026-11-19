---
title: "9. Add a frontend page"
description: Add a Notes page to the React or Vue frontend of a Fastify SelfAuth project, protect it with a permission, call your API with the built-in client and show admin-only controls.
keywords: [react page, vue page, RequireAuth, route meta permission, Can component, client.api, frontend permissions]
---

# 9. Add a frontend page

This chapter is for projects made with `--frontend react` or `--frontend vue`. If you only built an API, skip to [chapter 10](./tests). Every server file from the earlier chapters lives under `server/` in your project. The pages are in `client/`.

You'll add a Notes page that:

- only opens for users with `notes.view`,
- lists your notes and has a form to save one,
- shows admins a button to switch to everyone's notes.

## Start both servers

From the top folder of your project:

```bash
npm run dev
```

That starts the API and the frontend together. Open the address the `[client]` line prints: `http://localhost:5174` for React, `http://localhost:5173` for Vue. Sign in with Maya's account from chapter 2.

## Create the page

::: code-group

```tsx [React: client/src/pages/NotesPage.tsx]
import { useEffect, useState } from "react";
import { Can, describeError, useAuth } from "../auth/index.ts";

interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export function NotesPage() {
  const { client } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [everyone, setEveryone] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = async (all = everyone) => {
    try {
      const path = all ? "/api/admin/notes" : "/api/notes";
      const result = await client.api<{ notes: Note[] }>("GET", path);
      setNotes(result.notes);
    } catch (e) {
      setError(describeError(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await client.api("POST", "/api/notes", { text });
      setText("");
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const toggleEveryone = async () => {
    setEveryone(!everyone);
    await load(!everyone);
  };

  return (
    <>
      <h1>{everyone ? "Everyone's notes" : "Your notes"}</h1>
      {error && <p role="alert">{error}</p>}

      <Can permission="notes.create">
        <form onSubmit={(e) => void save(e)}>
          <input value={text} onChange={(e) => setText(e.target.value)} required maxLength={2000} />
          <button type="submit">Save note</button>
        </form>
      </Can>

      <Can permission="notes.view_any">
        <button onClick={() => void toggleEveryone()}>
          {everyone ? "Show only mine" : "Show everyone's"}
        </button>
      </Can>

      {notes.length === 0 ? (
        <p>No notes yet.</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      )}
    </>
  );
}
```

```vue [Vue: client/src/pages/NotesPage.vue]
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Can, describeError, useAuth } from "../auth/index.ts";

interface Note {
  id: string;
  text: string;
  createdAt: string;
}

const auth = useAuth();
const notes = ref<Note[]>([]);
const everyone = ref(false);
const text = ref("");
const error = ref("");

async function load() {
  try {
    const path = everyone.value ? "/api/admin/notes" : "/api/notes";
    const result = await auth.client.api<{ notes: Note[] }>("GET", path);
    notes.value = result.notes;
  } catch (e) {
    error.value = describeError(e);
  }
}

async function save() {
  error.value = "";
  try {
    await auth.client.api("POST", "/api/notes", { text: text.value });
    text.value = "";
    await load();
  } catch (e) {
    error.value = describeError(e);
  }
}

async function toggleEveryone() {
  everyone.value = !everyone.value;
  await load();
}

onMounted(load);
</script>

<template>
  <h1>{{ everyone ? "Everyone's notes" : "Your notes" }}</h1>
  <p v-if="error" role="alert">{{ error }}</p>

  <Can permission="notes.create">
    <form @submit.prevent="save">
      <input v-model="text" required maxlength="2000" />
      <button type="submit">Save note</button>
    </form>
  </Can>

  <Can permission="notes.view_any">
    <button @click="toggleEveryone">
      {{ everyone ? "Show only mine" : "Show everyone's" }}
    </button>
  </Can>

  <p v-if="notes.length === 0">No notes yet.</p>
  <ul v-else>
    <li v-for="note in notes" :key="note.id">{{ note.text }}</li>
  </ul>
</template>
```

:::

The two pieces SelfAuth gives you:

- **`client.api(method, path, body?)`** calls your API with the session cookie and the CSRF header already set, and turns error responses into exceptions. You never add a header yourself.
- **`<Can permission="…">`** only shows what's inside to users with that permission. Maya won't see the "Show everyone's" button. Sam will.

## Add the route

::: code-group

```tsx [React: client/src/App.tsx]
// At the top, with the other page imports:
import { NotesPage } from "./pages/NotesPage.tsx";

// Inside <Routes>, before the "/forbidden" route:
<Route
  path="/notes"
  element={
    <RequireAuth permission="notes.view">
      <NotesPage />
    </RequireAuth>
  }
/>
```

```ts [Vue: client/src/router.ts]
// Inside the routes list, before the "/forbidden" entry:
{
  path: "/notes",
  component: () => import("./pages/NotesPage.vue"),
  meta: { permission: "notes.view" },
},
```

:::

A visitor who isn't signed in is sent to the sign-in page, then brought back to `/notes` afterwards. A signed-in user without `notes.view` lands on the "Not allowed" page.

## Add a link

Put it next to the existing Account link in the header:

::: code-group

```tsx [React: Header() in client/src/App.tsx]
{auth.can("notes.view") && <Link to="/notes">Notes</Link>}
```

```vue [Vue: client/src/App.vue]
<RouterLink v-if="auth.can('notes.view')" to="/notes">Notes</RouterLink>
```

:::

## Check it worked

1. Sign out and open `/notes`. You land on the sign-in page.
2. Sign in as Maya. You're taken back to `/notes`. Save a note and it appears in the list. There's no "Show everyone's" button.
3. Sign out and sign in as Sam. The button is there, and it shows Maya's notes as well as his.

## Hiding isn't protecting

`<Can>` and the route guard make the page pleasant: people don't see buttons they can't use. They don't protect anything. Anyone can open the browser's developer tools and call `/api/admin/notes` directly. What stops them is `requirePermission("notes.view_any")` on the server, from chapter 7. Always guard the API first, then hide things in the page.

## If something went wrong

- **The page is blank and the console says `Failed to fetch`.** The API isn't running. Start both with `npm run dev` from the top folder, not from `client/`.
- **`/notes` always goes to "Not allowed".** The signed-in user lacks `notes.view`. Did you run `npm run db:seed` after chapter 5?
- **The email link opens a page that doesn't load.** `SELFAUTH_APP_BASE_URL` in `server/.env` must match the address the frontend runs on.

Next: [Test your endpoints](./tests)
