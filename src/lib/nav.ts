/** Sidebar helpers (pure, so they're testable): active state, and the remembered group and collapse state. */

/** Group labels the user collapsed, in localStorage. */
export const NAV_CLOSED_KEY = "fuobe:nav-closed";
/** Written by the shadcn SidebarProvider ("true" / "false"). */
export const SIDEBAR_COOKIE = "sidebar_state";

export const groupId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function pathMatches(path: string, pathname: string) {
  return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}

function queryMatches(query: string, search: URLSearchParams) {
  return [...new URLSearchParams(query)].every(([k, v]) => search.get(k) === v);
}

/**
 * Whether a nav link is the current page. A link with a query (`/library?tab=favorites`) is active
 * when the path and every one of its params match; a plain link is active on its path (and below it)
 * unless a sibling query link to the same path matches better.
 */
export function navActive(href: string, pathname: string, search: URLSearchParams, siblings: string[] = []): boolean {
  if (!pathname) return false;
  const [path, query] = href.split("?");
  if (!pathMatches(path, pathname)) return false;
  if (query) return queryMatches(query, search);
  return !siblings.some((s) => {
    const [p, q] = s.split("?");
    return !!q && p === path && pathMatches(p, pathname) && queryMatches(q, search);
  });
}

/** Read the collapsed groups (ids) from storage; tolerant of anything unexpected. */
export function parseClosed(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function sidebarOpenFromCookie(cookie: string): boolean {
  return !new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE}=false(?:;|$)`).test(cookie);
}

/**
 * Inline script that applies the remembered state to the server-rendered sidebar before the first
 * paint: the collapsed rail (cookie) and collapsed groups (localStorage). React's first client render
 * reads the same values, so hydration matches the patched DOM.
 */
export const SIDEBAR_STATE_SCRIPT = `(function(){try{var d=document;if(/(?:^|;\\s*)${SIDEBAR_COOKIE}=false(?:;|$)/.test(d.cookie)){var s=d.querySelector('[data-slot="sidebar"]');if(s){s.setAttribute("data-state","collapsed");s.setAttribute("data-collapsible","icon")}}var c=JSON.parse(localStorage.getItem("${NAV_CLOSED_KEY}")||"[]");if(Array.isArray(c))c.forEach(function(g){var e=d.querySelector('[data-nav-group="'+String(g).replace(/[^a-z0-9-]/g,"")+'"]');if(e){e.setAttribute("data-open","false");var b=e.querySelector("[data-nav-toggle]");if(b)b.setAttribute("aria-expanded","false")}})}catch(e){}})()`;
