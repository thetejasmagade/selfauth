/**
 * Reads a one-time token from the URL fragment (`#token=…`) and removes it
 * from the address bar and history immediately, so it does not linger or leak
 * through screenshots, history sync, or `Referer` (SEC-TOKEN-005). Fragments
 * are never sent to servers.
 */
export function takeTokenFromFragment(
  location: Location = window.location,
  history: History = window.history,
): string | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (location.hash)
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return token && /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : null;
}
