import react from "@vitejs/plugin-react";
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
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy, headers },
  preview: { port: 4174, strictPort: true, proxy, headers },
});
