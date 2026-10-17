/**
 * Where to go after signing in: only a path on this site. "/\evil.example" or "/\t/evil.example"
 * look like paths but the URL parser reads them as another host, so the check resolves the URL
 * and compares origins instead of looking at the first characters.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next) return "/";
  try {
    const u = new URL(next, origin);
    return u.origin === new URL(origin).origin ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}
