import { RELAY_LIMITS, TAB_FAILURES, type ReportEvent } from "@/lib/relay";
import { gateAsProxy, readBodyWithin } from "@/server/direct-gate";
import { principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { leased, report } from "@/server/computer/tasks";
import { onComputer, planRelayOutputs } from "@/server/providers/comfyui";

const EVENTS = new Set(["sent", "refused", "queued", "running", "finished", "passes", "gone", "comfy-down", "stopped", "failed"]);

/** The event as the tab sent it, with only the fields each one has, or null. */
function eventOf(b: Record<string, unknown>): ReportEvent | null {
  const e = b.event;
  if (typeof e !== "string" || !EVENTS.has(e)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  switch (e) {
    case "sent":
      return typeof b.promptId === "string" ? { event: e, promptId: b.promptId, number: num(b.number) } : null;
    case "refused":
      return { event: e, status: num(b.status) ?? 400, body: b.body };
    case "queued":
      return { event: e, position: num(b.position) ?? -1 };
    case "running":
      return { event: e, value: num(b.value), max: num(b.max), nodesDone: num(b.nodesDone), ...(typeof b.node === "string" && { node: b.node }) };
    case "finished":
      return b.entry && typeof b.entry === "object" ? { event: e, entry: b.entry as never } : null;
    case "passes":
      return Array.isArray(b.entries) && b.entries.length <= 64 ? { event: e, running: b.running === true, entries: b.entries as never } : null;
    case "failed":
      return typeof b.reason === "string" && (TAB_FAILURES as readonly string[]).includes(b.reason) ? { event: e, reason: b.reason as never, status: num(b.status) } : null;
    default:
      return { event: e as "gone" | "comfy-down" | "stopped" };
  }
}

/**
 * The tab's report about a job it took (its token in the body): sent, refused, where it is in the queue, its steps, its
 * finished /history entry (up to 8 MB), ComfyUI gone or down, a stop done. Each is taken only where the job is. The
 * answer to a finished prompt names the files to upload. The proxy doesn't run on this route (a big entry): its checks
 * run here.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/report">) {
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "report", 300);
  if (limited) return limited;
  const raw = await readBodyWithin(request, RELAY_LIMITS.reportBytes);
  if (raw === "too-big") return Response.json({ error: "That report is too large" }, { status: 413 });
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : null;
  } catch {}
  const event = body && typeof body === "object" ? eventOf(body) : null;
  if (!event) return Response.json({ error: "Not a report" }, { status: 400 });
  const { id } = await ctx.params;
  try {
    const t = leased(principal, id, body!.lease);
    return Response.json(
      report(t, event, (entries, passes) => onComputer(principal, () => planRelayOutputs(t, entries, passes))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return relayAnswer(e);
  }
}
