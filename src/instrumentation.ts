/**
 * Runs once when the server starts: start the generation runner right away, so jobs that were in
 * flight before a restart keep advancing (and live updates flow) even when the UI only lists them.
 * Also empties what has been in the Trash for 30 days (then daily).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureRunner } = await import("./server/generations");
  ensureRunner();
  const { ensureTrashPurge } = await import("./server/library");
  ensureTrashPurge();
  // Faceless / Explainer renders whose narration was timed while the server was down continue with their scenes.
  const { ensureFacelessRunner } = await import("./server/faceless");
  ensureFacelessRunner();
}
