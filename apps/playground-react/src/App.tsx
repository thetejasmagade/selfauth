import { Link, Route, Routes, useNavigate } from "react-router";
import { Can, GuestOnly, RequireAuth, useAuth } from "./auth/index.ts";
import { AccountPage } from "./pages/AccountPage.tsx";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NotesPage } from "./pages/NotesPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.tsx";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.tsx";

function Header() {
  const auth = useAuth();
  const navigate = useNavigate();
  const logout = async () => {
    await auth.store.logout();
    void navigate("/login");
  };
  return (
    <header>
      <Link to="/">
        <strong>SelfAuth</strong>
      </Link>
      {auth.isAuthenticated && (
        <>
          <Link to="/notes">Notes</Link>
          <Link to="/account">Account</Link>
          <Can permission="notes.view_any">
            <span data-testid="support-badge">Support</span>
          </Can>
        </>
      )}
      <span className="spacer" />
      {auth.status === "loading" ? (
        <span>Loading…</span>
      ) : auth.isAuthenticated ? (
        <>
          <span data-testid="current-email">{auth.user?.email}</span>
          <button className="secondary" data-testid="logout" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <Link to="/login">Sign in</Link>
          <Link to="/register">Create account</Link>
        </>
      )}
    </header>
  );
}

function Home() {
  const auth = useAuth();
  return (
    <>
      <h1>SelfAuth React playground</h1>
      {auth.isAuthenticated ? (
        <p>
          Signed in. Go to your <Link to="/notes">notes</Link>.
        </p>
      ) : (
        <p>
          <Link to="/login">Sign in</Link> or <Link to="/register">create an account</Link>.
        </p>
      )}
    </>
  );
}

export function App() {
  const auth = useAuth();
  return (
    <>
      <Header />
      <main>
        {auth.status === "loading" ? (
          <p>Checking your session…</p>
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/login"
              element={
                <GuestOnly home="/notes">
                  <LoginPage />
                </GuestOnly>
              }
            />
            <Route
              path="/register"
              element={
                <GuestOnly home="/notes">
                  <RegisterPage />
                </GuestOnly>
              }
            />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/notes"
              element={
                <RequireAuth>
                  <NotesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route
              path="/forbidden"
              element={
                <>
                  <h1>Not allowed</h1>
                  <p>You do not have permission to view this page.</p>
                </>
              }
            />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <p>
                    <Link to="/">Go home</Link>
                  </p>
                </>
              }
            />
          </Routes>
        )}
      </main>
    </>
  );
}
