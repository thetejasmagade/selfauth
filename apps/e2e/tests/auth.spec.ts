import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import type { E2EOptions } from "../playwright.config.ts";

/** Same spec for every frontend; `backendUrl` comes from the project. */
const test = base.extend<E2EOptions>({ backendUrl: ["http://localhost:3100", { option: true }] });

const PASSWORD = "correct horse battery staple";
let counter = 0;
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${counter++}@example.test`;

/** Reads the last email for `to` from the test backend and returns its link path. */
async function mailLink(
  request: APIRequestContext,
  backendUrl: string,
  to: string,
  kind: string,
): Promise<string> {
  let mail: { kind: string; link: string } | null = null;
  await expect
    .poll(async () => {
      mail = await (
        await request.get(`${backendUrl}/__e2e/mail?to=${encodeURIComponent(to)}`)
      ).json();
      return mail?.kind;
    })
    .toBe(kind);
  const url = new URL(mail!.link);
  expect(url.origin).toBe(new URL(test.info().project.use.baseURL!).origin); // links point at this frontend
  return `${url.pathname}${url.hash}`;
}

async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("register-done")).toBeVisible();
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function verifiedUser(
  page: Page,
  request: APIRequestContext,
  backendUrl: string,
  label: string,
) {
  const email = uniqueEmail(label);
  await register(page, email);
  await page.goto(await mailLink(request, backendUrl, email, "verification"));
  await expect(page.getByTestId("verified")).toBeVisible();
  return email;
}

test("register, verify by email link, sign in, use the app, sign out", async ({
  page,
  request,
  backendUrl,
}) => {
  const email = uniqueEmail("alice");
  await register(page, email);

  // Unverified accounts cannot sign in yet.
  await page.goto("/login");
  await signIn(page, email);
  await expect(page.getByRole("alert")).toContainText("verify your email");

  const link = await mailLink(request, backendUrl, email, "verification");
  expect(link).toMatch(/^\/verify-email#token=/);
  const verify = await page.goto(link);
  expect(verify?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByTestId("verified")).toBeVisible();
  expect(page.url()).not.toContain("token="); // stripped from the address bar (SEC-TOKEN-005)

  // A protected page sends us to login and back.
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByTestId("current-email")).toHaveText(email);

  // The session cookie is HttpOnly: invisible to JavaScript (SEC-COOKIE-001).
  expect(await page.evaluate(() => document.cookie)).not.toContain("session");

  await page.getByLabel("New note").fill("hello from the browser");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByTestId("notes")).toContainText("hello from the browser");

  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test("wrong passwords and unknown accounts look the same", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, uniqueEmail("nobody"), "wrong password!!");
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
});

test("post-login redirects never leave the site (SEC-REDIRECT-001)", async ({
  page,
  request,
  backendUrl,
}) => {
  const email = await verifiedUser(page, request, backendUrl, "redirect");
  for (const target of ["https://evil.test/", "//evil.test", "/\\evil.test"]) {
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
    await signIn(page, email);
    await expect(page).toHaveURL(`${new URL(test.info().project.use.baseURL!).origin}/notes`);
    await expect(page.getByTestId("current-email")).toHaveText(email);
    await page.getByTestId("logout").click();
  }
});

test("password reset by email link signs out every device", async ({
  browser,
  page,
  request,
  backendUrl,
}) => {
  const email = await verifiedUser(page, request, backendUrl, "reset");
  await page.goto("/login");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/notes$/);

  const other = await browser.newPage();
  await other.goto("/forgot-password");
  await other.getByLabel("Email").fill(email);
  await other.getByRole("button", { name: "Send reset link" }).click();
  await expect(other.getByTestId("reset-sent")).toBeVisible();

  await other.goto(await mailLink(request, backendUrl, email, "passwordReset"));
  await expect(other.getByLabel("New password")).toBeVisible();
  expect(other.url()).not.toContain("token="); // stripped once the page has loaded
  await other.getByLabel("New password").fill("a completely new passphrase");
  await other.getByRole("button", { name: "Change password" }).click();
  await expect(other.getByTestId("reset-done")).toBeVisible();

  // The first browser's session was revoked server-side; the app notices.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await signIn(page, email, "a completely new passphrase");
  await expect(page).toHaveURL(/\/account$/);
  await other.close();
});

test("bypassing frontend checks does not bypass the backend (AUTHZ-CORE-004)", async ({
  page,
  request,
  backendUrl,
}) => {
  const owner = await verifiedUser(page, request, backendUrl, "owner");
  await page.goto("/login");
  await signIn(page, owner);
  await page.getByLabel("New note").fill("private note");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByTestId("notes")).toContainText("private note");
  const noteId = await page.evaluate(async () => {
    const res = await fetch("/api/notes", { credentials: "include" });
    return ((await res.json()) as { notes: { id: string }[] }).notes[0]!.id;
  });
  await page.getByTestId("logout").click();

  const intruder = await verifiedUser(page, request, backendUrl, "intruder");
  await page.goto("/login");
  await signIn(page, intruder);
  await expect(page.getByTestId("current-email")).toHaveText(intruder);
  await expect(page.getByTestId("support-badge")).toHaveCount(0);

  // Hand-crafted requests from the page, ignoring every UI guard.
  const results = await page.evaluate(async (id) => {
    const headers = { "Content-Type": "application/json", "X-SelfAuth-CSRF": "1" };
    const read = await fetch(`/api/notes/${id}`, { credentials: "include" });
    const admin = await fetch(`/auth/admin/users/${id}/state`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ state: "suspended" }),
    });
    const noCsrf = await fetch("/auth/logout-all", { method: "POST", credentials: "include" });
    return { read: read.status, admin: admin.status, noCsrf: noCsrf.status };
  }, noteId);
  expect(results).toEqual({ read: 404, admin: 403, noCsrf: 403 });
});

test("permission-aware UI reflects role changes on refresh", async ({
  page,
  request,
  backendUrl,
}) => {
  const email = await verifiedUser(page, request, backendUrl, "support");
  await page.goto("/login");
  await signIn(page, email);
  await expect(page.getByTestId("current-email")).toHaveText(email);
  await expect(page.getByTestId("support-badge")).toHaveCount(0);
  // The test-only grant route sits behind the app's CSRF middleware like every route.
  const grant = await request.post(`${backendUrl}/__e2e/grant`, {
    data: { email, role: "support" },
    headers: { "X-SelfAuth-CSRF": "1" },
  });
  expect(grant.status()).toBe(204);
  await page.reload();
  await expect(page.getByTestId("support-badge")).toBeVisible();
});
