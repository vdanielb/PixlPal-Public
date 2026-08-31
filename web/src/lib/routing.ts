/**
 * Tiny pathname router for the legal pages. Avoids a router dependency for
 * two static documents plus the editor.
 */

export type AppRoute = "editor" | "privacy" | "terms";

export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function routeFromPath(pathname: string): AppRoute {
  const path = normalizePath(pathname);
  if (path === "/privacy") return "privacy";
  if (path === "/terms") return "terms";
  return "editor";
}

export function navigate(path: string): void {
  const next = normalizePath(path);
  if (normalizePath(window.location.pathname) === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
