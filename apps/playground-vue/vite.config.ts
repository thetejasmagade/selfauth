import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * Same-origin topology (recommended): the browser talks only to this origin;
 * /auth and /api are proxied to the Express backend, so the session cookie
 * stays SameSite=Lax and no CORS is needed. See docs/frontend-deployment.md.
 */
const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
const proxy = {
  "/auth": { target, changeOrigin: false },
  "/api": { target, changeOrigin: false },
};
const headers = { "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, strictPort: true, proxy, headers },
  preview: { port: 4173, strictPort: true, proxy, headers },
});
