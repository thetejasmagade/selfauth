/**
 * Validates a post-login redirect target taken from the URL (SEC-REDIRECT-001).
 * Only same-origin relative paths are allowed; anything else falls back.
 */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string" || target.length === 0 || target.length > 2048) return fallback;
  // Must be a path: "/x", never "//host", "/\host", "\\host", or a scheme.
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  // Control characters are rejected on purpose: browsers strip some of them, turning "/\t/evil" into "//evil".
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return fallback;
  const sentinel = "http://selfauth.invalid";
  try {
    const url = new URL(target, sentinel);
    if (url.origin !== sentinel) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
