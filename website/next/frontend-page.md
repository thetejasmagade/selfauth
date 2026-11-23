---
title: "7. Add a page for the notes"
description: Show the notes in your Next.js app with a page, a link in the header and a screen that calls the notes routes through SelfAuth's browser client, with sign-in and permission checks for the page.
keywords: [next.js page, app router page, client component, RequireAuth, Can, client.api, selfauth auth-client, notes page]
---

# 7. Add a page for the notes

The notes routes work. Now give people a page to use them. A Next.js page is a `page.tsx` file, and SelfAuth's browser module, `src/auth-client/`, gives you what a page needs to know about the signed-in user.

## The browser module

Open `src/auth-client/index.ts`. It exports a few things you'll use:

| Name | What it is |
| --- | --- |
| `useAuth()` | The current state: `status` (`loading`, `authenticated` or `unauthenticated`), `user`, `can(permission)`, `hasRole(role)`, and `client` for calling the API |
| `<RequireAuth permission?>` | Shows its children only to signed-in users; others go to the sign-in page and come back afterwards |
| `<GuestOnly>` | The opposite: for the sign-in and sign-up pages |
| `<Can permission="…">` | Shows something only to people who hold a permission |
| `client.api(method, path, body?)` | Calls your own API with the cookie and the CSRF header done for you |

::: warning The page is for show. The route is the lock.
`<RequireAuth>` and `<Can>` only decide what to *draw*. Anyone can still call `/api/notes` with `curl`, and they're stopped there, by the guards you wrote in chapter 6. Never rely on hiding a button.
:::

## Write the page

A page file only chooses what to draw. Create `src/app/notes/page.tsx`:

```tsx
import { RequireAuth } from "../../auth-client/index.ts";
import { NotesScreen } from "../../screens/NotesScreen.tsx";

export default function Page() {
  return (
    <RequireAuth>
      <NotesScreen />
    </RequireAuth>
  );
}
```

And the screen itself, `src/screens/NotesScreen.tsx`. The first line, `"use client"`, matters: it says this code runs in the browser, which is where `useAuth` and the form live:

```tsx
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError, useAuth } from "../auth-client/index.ts";

interface Note {
  id: string;
  text: string;
  ownerId: string;
}

export function NotesScreen() {
  const { client } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setNotes((await client.api<{ notes: Note[] }>("GET", "/api/notes")).notes);
  }, [client]);

  useEffect(() => {
    load().catch((e: unknown) => setError(describeError(e)));
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await client.api("POST", "/api/notes", { text });
      setText("");
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <>
      <h1>Notes</h1>
      <form onSubmit={(e) => void add(e)}>
        <label>
          New note{" "}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            name="text"
            required
            maxLength={2000}
          />
        </label>
        <button type="submit">Add note</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul data-testid="notes">
        {notes.map((note) => (
          <li key={note.id}>{note.text}</li>
        ))}
      </ul>
      {notes.length === 0 && <p>No notes yet.</p>}
    </>
  );
}
```

`client.api` throws an error with SelfAuth's `code` when the route answers with one, and `describeError` turns it into a sentence a person can read. You never parse the response by hand.

## Link to it

Open `src/app/header.tsx` and add the link next to **Account**:

```tsx
{auth.isAuthenticated && (
  <>
    <Link href="/notes">Notes</Link>
    <Link href="/account">Account</Link>
  </>
)}
```

You can use `<Can>` to show something only to admins. Add this inside the same block, after the links, and it appears for Sam but not for Maya:

```tsx
<Can permission="notes.view_any">
  <span>Admin</span>
</Can>
```

(`Can` comes from the same import as `useAuth`: change the import at the top to `import { Can, useAuth } from "../auth-client/index.ts";`.)

## Check it worked

Open `http://localhost:3000/notes` while signed out. You're sent to the sign-in page, and after you sign in you come back to the notes. Add a note: it appears in the list. Reload the page: it's still there. Sign out, sign in as Sam, and you see only Sam's notes, with the **Admin** badge in the header.

## How the page learns who you are

A Next.js page is drawn on the server first, as the same HTML for everyone, and then the browser takes over. SelfAuth's module asks `/auth/me` once the page is in the browser, and until it answers the header shows "Loading…" and `<RequireAuth>` draws nothing. That's why a signed-in user never sees a flash of another person's page, and why a page can never be cached with one person's name in it.

The trade-off is that signed-in content appears a moment after the page. If you need the server to know who's signed in (to draw it in the first response), do that in a route handler, where `call.auth` is available, and have the page fetch it.

## If something went wrong

- **The page is blank after sign-in.** Open the browser's developer tools. A red error in the console usually names the problem. A missing `"use client"` on the first line of the screen is the usual cause.
- **You're sent to the sign-in page even though you're signed in.** The page loaded before `/auth/me` answered a cookie. Reload once. If it keeps happening, the cookie isn't being sent: check `SELFAUTH_APP_BASE_URL` matches the address in the browser.
- **`Module not found: Can't resolve '../auth-client/index.ts'`.** The path is relative to the file. A page is two folders deeper than a screen.

Next: [Change a table later](./change-a-table)
