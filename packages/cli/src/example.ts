/**
 * The reference frontends (apps/playground-vue, apps/playground-react) include a "notes" page that
 * the browser tests use to prove permissions and ownership. Generated projects ship without it: a
 * small starter should not carry a demo you have to delete. The reference apps stay the single
 * tested source, so the demo is removed at generation time with exact replacements. Each must
 * match, or generation fails loudly and this file is updated (the same rule as adaptForAdd).
 */

/** Files that exist only for the notes demo (targets, as in the registry). */
const DEMO_FILES = new Set(["web/src/pages/NotesPage.vue", "web/src/pages/NotesPage.tsx"]);

interface Replacement {
  from: string;
  to: string;
  /** How many times `from` must occur. */
  count?: number;
}

const NOTES_TO_ACCOUNT = (count = 1): Replacement => ({
  from: '"/notes"',
  to: '"/account"',
  count,
});

const EDITS: Record<string, Replacement[]> = {
  "web/src/App.vue": [
    {
      from: 'import { Can, useAuth } from "./auth/index.ts";',
      to: 'import { useAuth } from "./auth/index.ts";',
    },
    {
      from: `      <RouterLink to="/notes">Notes</RouterLink>
      <RouterLink to="/account">Account</RouterLink>
      <Can permission="notes.view_any"><span data-testid="support-badge">Support</span></Can>
`,
      to: `      <RouterLink to="/account">Account</RouterLink>
`,
    },
  ],
  "web/src/router.ts": [
    {
      from: `      {
        path: "/notes",
        component: () => import("./pages/NotesPage.vue"),
        meta: { requiresAuth: true },
      },
`,
      to: "",
    },
  ],
  "web/src/pages/HomePage.vue": [
    {
      from: 'Signed in. Go to your <RouterLink to="/notes">notes</RouterLink>.',
      to: 'Signed in. Go to your <RouterLink to="/account">account</RouterLink>.',
    },
  ],
  // Doc comments that used the demo's permission as their example.
  "web/src/auth/vue.ts": [{ from: "notes.view_any", to: "orders.view" }],
  "web/src/auth/react.tsx": [{ from: "notes.view_any", to: "orders.view" }],
  "web/src/pages/auth/LoginPage.vue": [NOTES_TO_ACCOUNT()],
  "web/src/pages/auth/RegisterPage.vue": [NOTES_TO_ACCOUNT()],
  "web/src/main.ts": [NOTES_TO_ACCOUNT()],
  "web/src/App.tsx": [
    {
      from: 'import { Can, GuestOnly, RequireAuth, useAuth } from "./auth/index.ts";',
      to: 'import { GuestOnly, RequireAuth, useAuth } from "./auth/index.ts";',
    },
    { from: 'import { NotesPage } from "./pages/NotesPage.tsx";\n', to: "" },
    {
      from: `      {auth.isAuthenticated && (
        <>
          <Link to="/notes">Notes</Link>
          <Link to="/account">Account</Link>
          <Can permission="notes.view_any">
            <span data-testid="support-badge">Support</span>
          </Can>
        </>
      )}
`,
      to: `      {auth.isAuthenticated && <Link to="/account">Account</Link>}
`,
    },
    {
      from: 'Signed in. Go to your <Link to="/notes">notes</Link>.',
      to: 'Signed in. Go to your <Link to="/account">account</Link>.',
    },
    { from: '<GuestOnly home="/notes">', to: '<GuestOnly home="/account">', count: 2 },
    {
      from: `            <Route
              path="/notes"
              element={
                <RequireAuth>
                  <NotesPage />
                </RequireAuth>
              }
            />
`,
      to: "",
    },
  ],
  "web/src/pages/auth/LoginPage.tsx": [NOTES_TO_ACCOUNT()],
  "web/src/pages/auth/RegisterPage.tsx": [NOTES_TO_ACCOUNT()],
};

export const isDemoFile = (target: string): boolean => DEMO_FILES.has(target);

/** `content` of a frontend file without the notes demo; unchanged for files the demo never touched. */
export function withoutNotesExample(target: string, content: string): string {
  let out = content;
  for (const { from, to, count = 1 } of EDITS[target] ?? []) {
    const found = out.split(from).length - 1;
    if (found !== count) {
      throw new Error(
        `${target} changed: expected ${count} match(es) of ${JSON.stringify(from.slice(0, 50))} but found ${found}; update packages/cli/src/example.ts`,
      );
    }
    out = out.replaceAll(from, to);
  }
  return out;
}
