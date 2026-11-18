---
title: Add a frontend page
description: Add a new page with its route, a permission-protected page and a call to your API in a SelfAuth Vue or React project. Includes the Can component, route guards and the API client.
keywords: [vue router, react router, add page, requiresAuth, permission, Can component, client.api, frontend routes]
---

# Add a frontend page

This guide adds an Orders page that

- lives at `/orders`;
- can only be opened by users holding the `orders.view` permission;
- loads its data from the `/api/orders` route from [Resources and ownership](./resource-ownership);
- shows a form only to users holding `orders.create`.

It applies to projects made with `--frontend vue` or `--frontend react`. Both versions were type-checked in generated projects.

## Where things are

| What | Vue | React |
| --- | --- | --- |
| Your pages | `client/src/pages/*.vue` | `client/src/pages/*.tsx` |
| The list of routes | `client/src/router.ts` | the `<Routes>` in `client/src/App.tsx` |
| The header and navigation | `client/src/App.vue` | `Header()` in `client/src/App.tsx` |
| Entry point | `client/src/main.ts` | `client/src/main.tsx` |
| The auth module | `client/src/auth/` | `client/src/auth/` |

## Step 1: Create the page

::: code-group

```vue [Vue: client/src/pages/OrdersPage.vue]
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Can, describeError, useAuth } from "../auth/index.ts";

interface Order {
  id: string;
  item: string;
}

const auth = useAuth();
const orders = ref<Order[]>([]);
const item = ref("");
const error = ref("");

async function load() {
  try {
    orders.value = await auth.client.api<Order[]>("GET", "/api/orders");
  } catch (e) {
    error.value = describeError(e);
  }
}

async function create() {
  error.value = "";
  try {
    await auth.client.api("POST", "/api/orders", { item: item.value });
    item.value = "";
    await load();
  } catch (e) {
    error.value = describeError(e);
  }
}

onMounted(load);
</script>

<template>
  <h1>Your orders</h1>
  <p v-if="error" role="alert">{{ error }}</p>
  <ul>
    <li v-for="order in orders" :key="order.id">{{ order.item }}</li>
  </ul>
  <p v-if="orders.length === 0">No orders yet.</p>

  <Can permission="orders.create">
    <form @submit.prevent="create">
      <input v-model="item" required placeholder="What do you want to order?" />
      <button type="submit">Add order</button>
    </form>
  </Can>
</template>
```

```tsx [React: client/src/pages/OrdersPage.tsx]
import { useEffect, useState } from "react";
import { Can, describeError, useAuth } from "../auth/index.ts";

interface Order {
  id: string;
  item: string;
}

export function OrdersPage() {
  const { client } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [item, setItem] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setOrders(await client.api<Order[]>("GET", "/api/orders"));
    } catch (e) {
      setError(describeError(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await client.api("POST", "/api/orders", { item });
      setItem("");
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <>
      <h1>Your orders</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.item}</li>
        ))}
      </ul>
      {orders.length === 0 && <p>No orders yet.</p>}
      <Can permission="orders.create">
        <form onSubmit={(e) => void create(e)}>
          <input value={item} onChange={(e) => setItem(e.target.value)} required />
          <button type="submit">Add order</button>
        </form>
      </Can>
    </>
  );
}
```

:::

Important parts:

- `client.api(method, path, body?)` calls your own API with the same cookie, CSRF header and error handling as the auth calls. You do not set any header yourself. It resolves to the parsed JSON, and the type argument (`<Order[]>`) is only a hint for TypeScript.
- Failures throw an `AuthApiError` with a `code`. `describeError(e)` turns it into text you can show.
- The path starts with `/api`, so the dev-server proxy forwards it.

## Step 2: Register the route

::: code-group

```ts [Vue: client/src/router.ts]
// add this entry inside the `routes: [ ... ]` list, before the "/forbidden" entry
{
  path: "/orders",
  component: () => import("./pages/OrdersPage.vue"),
  meta: { permission: "orders.view" },
},
```

```tsx [React: client/src/App.tsx]
// import at the top
import { OrdersPage } from "./pages/OrdersPage.tsx";

// add inside <Routes>, before the "/forbidden" route
<Route
  path="/orders"
  element={
    <RequireAuth permission="orders.view">
      <OrdersPage />
    </RequireAuth>
  }
/>
```

:::

### What the route protection does

| Situation | Vue (`meta`) | React (`<RequireAuth>`) |
| --- | --- | --- |
| Signed out | Redirected to `/login?redirect=/orders` | Redirected to the login page, with a validated return path |
| Signed in, no `orders.view` | Redirected to `/forbidden` | Redirected to `/forbidden` |
| Allowed | The page opens | The page opens |

The meta keys in Vue are:

| Key | Meaning |
| --- | --- |
| `requiresAuth: true` | Needs a signed-in user |
| `permission: "x.y"` | Needs that permission (implies signed in) |
| `guestOnly: true` | Only for signed-out users (login and register use it) |

After sign-in the user goes back to where they were headed. The redirect target passes through `safeRedirect`, which accepts only relative paths on your own site.

## Step 3: Add a link in the navigation

::: code-group

```vue [Vue: client/src/App.vue]
<RouterLink v-if="auth.can('orders.view')" to="/orders">Orders</RouterLink>
```

```tsx [React: Header() in client/src/App.tsx]
{auth.can("orders.view") && <Link to="/orders">Orders</Link>}
```

:::

Put it next to the existing `Account` link, inside the signed-in part of the header.

## Step 4: Run it

```bash
npm run dev
```

Open `http://localhost:5173/orders`:

1. Signed out: you land on the sign-in page.
2. Sign in as a user whose role holds `orders.view` (see [Permissions and roles](./permissions-roles)). The page opens and shows the list.
3. Sign in as a user without it: you land on "Not allowed" (`/forbidden`).

## Hide parts of a page with `Can`

`<Can>` renders its content only when the user holds a permission (or a role):

::: code-group

```vue [Vue]
<Can permission="orders.create">...form...</Can>
<Can role="admin">...admin tools...</Can>
```

```tsx [React]
<Can permission="orders.create">...form...</Can>
<Can role="admin" fallback={<p>Admins only.</p>}>...admin tools...</Can>
```

:::

You can also check in code: `auth.can("orders.view")` and `auth.hasRole("admin")`.

::: danger The browser is not a security boundary
Route protection and `<Can>` improve the experience only. The API enforces every permission, so even if someone edits the page in their browser, `/api/orders` still answers `403`. Never rely on the frontend alone.
:::

## Add a page that does not need sign-in

Skip `meta` (Vue) or `<RequireAuth>` (React):

::: code-group

```ts [Vue]
{ path: "/about", component: () => import("./pages/AboutPage.vue") },
```

```tsx [React]
<Route path="/about" element={<AboutPage />} />
```

:::

## Styling

The generated pages are plain HTML on purpose. Add your own CSS file and import it in `main.ts` or `main.tsx`.

## Change the password length in the forms

The forms carry a browser hint of the minimum length. If you raise `authentication.password.minLength` on the server, update the `minlength` / `minLength` attribute on the register, reset-password and account pages. See [Password](/configuration/config-file#password).
