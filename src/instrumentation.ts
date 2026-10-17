/**
 * Runs once when the server starts: start the generation runner right away, so jobs that were in
 * flight before a restart keep advancing (and live updates flow) even when the UI only lists them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureRunner } = await import("./server/generations");
  ensureRunner();
}
