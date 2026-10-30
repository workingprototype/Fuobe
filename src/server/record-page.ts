import "server-only";
import { headers } from "next/headers";
import type { RecordRef } from "@/lib/record-pages";
import { resolvePrincipal } from "./identity/principal";
import { recordVisible } from "./records";

/**
 * For a record page (a project, a canvas, an element…): whether the person loading it can see the record. The proxy
 * answers a page load first; this covers client-side navigations, which the proxy can't tell apart. Pages aren't
 * route handlers, so the person is resolved here from the request's own headers, as handler() would.
 */
export async function pageRecordVisible(ref: RecordRef): Promise<boolean> {
  const h = await headers();
  const { actor } = await resolvePrincipal(new Request(`http://${h.get("host") ?? "localhost"}/`, { headers: h }));
  return recordVisible(ref, actor);
}
