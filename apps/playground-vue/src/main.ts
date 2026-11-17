import { createApp } from "vue";
import App from "./App.vue";
import {
  createAuthClient,
  createAuthPlugin,
  createAuthStore,
  installAuthGuard,
} from "./auth/index.ts";
import { createAppRouter } from "./router.ts";

const router = createAppRouter();
const client = createAuthClient({
  // Session ended elsewhere (expiry, logout on another device, suspension).
  onUnauthenticated: () => {
    store.markSignedOut();
    if (router.currentRoute.value.meta.requiresAuth) {
      void router.push({ path: "/login", query: { redirect: router.currentRoute.value.fullPath } });
    }
  },
});
const store = createAuthStore(client);
installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/notes" });

createApp(App).use(createAuthPlugin(store)).use(router).mount("#app");
