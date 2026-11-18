/**
 * Hash routes, and the registry plugins add their screens to.
 *
 * Hash-based so the static nginx deploy needs no rewrite rules and a link can
 * carry query parameters (`#/contacts/new?name=…`) for the bookmarklet and the
 * phone share menu. Still no router library: a route is a pattern and a render
 * function, matched in registration order.
 *
 * A plugin (LinkedIn, Gmail, Matrix…) registers its screens from its own
 * module and is imported once in `main.ts`:
 *
 *   registerRoute({ pattern: "/linkedin", nav: "LinkedIn", render: renderLinkedIn });
 */
import type { CrmData, CrmStore } from "./store";

export interface Ctx {
  app: HTMLElement;
  store: CrmStore;
  /** Loaded once per navigation; current as of the moment the screen rendered. */
  data: CrmData;
  webId: string;
  podUrl: string;
  /** Route parameters (`:id`). */
  params: Record<string, string>;
  /** Query parameters after `?` in the hash. */
  query: URLSearchParams;
  /** Goes to a hash path; reloads the data and renders it. */
  go(path: string): void;
  /** Reloads the data and renders the current screen again. */
  refresh(): Promise<void>;
}

export interface Route {
  /** `/contacts/:id` — segments starting with `:` are parameters. */
  pattern: string;
  render(ctx: Ctx): void | Promise<void>;
  /** When set, a top navigation entry with this label links to `pattern`. */
  nav?: string;
  /** Lower comes first in the navigation. Core entries use 10, 20, 30… */
  navOrder?: number;
}

const routes: Route[] = [];

export function registerRoute(route: Route): void {
  routes.push(route);
}

export function navEntries(): { label: string; path: string }[] {
  return routes
    .filter((r) => r.nav)
    .sort((a, b) => (a.navOrder ?? 100) - (b.navOrder ?? 100))
    .map((r) => ({ label: r.nav!, path: r.pattern }));
}

/** Splits `#/contacts/abc?x=1` into a path and its query. */
export function parseHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.replace(/^#/, "") || "/";
  const q = raw.indexOf("?");
  const path = (q === -1 ? raw : raw.slice(0, q)) || "/";
  return { path: path.startsWith("/") ? path : `/${path}`, query: new URLSearchParams(q === -1 ? "" : raw.slice(q + 1)) };
}

/** Matches one pattern against a path; returns the parameters, or null. */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function resolve(path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

/** The short id in a record IRI (`…/contacts.ttl#k3j9…` → `k3j9…`), for URLs. */
export function shortId(iri: string): string {
  return iri.slice(iri.lastIndexOf("#") + 1);
}
