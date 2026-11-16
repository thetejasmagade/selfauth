import { createRouter, createWebHistory, type RouterHistory } from "vue-router";

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: "/", component: () => import("./pages/HomePage.vue") },
      {
        path: "/login",
        component: () => import("./pages/LoginPage.vue"),
        meta: { guestOnly: true },
      },
      {
        path: "/register",
        component: () => import("./pages/RegisterPage.vue"),
        meta: { guestOnly: true },
      },
      { path: "/verify-email", component: () => import("./pages/VerifyEmailPage.vue") },
      { path: "/forgot-password", component: () => import("./pages/ForgotPasswordPage.vue") },
      { path: "/reset-password", component: () => import("./pages/ResetPasswordPage.vue") },
      {
        path: "/notes",
        component: () => import("./pages/NotesPage.vue"),
        meta: { requiresAuth: true },
      },
      {
        path: "/account",
        component: () => import("./pages/AccountPage.vue"),
        meta: { requiresAuth: true },
      },
      { path: "/forbidden", component: () => import("./pages/ForbiddenPage.vue") },
      { path: "/:pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue") },
    ],
  });
}
