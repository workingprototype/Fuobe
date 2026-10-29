/**
 * Runs once when the server starts, before it takes requests. First the identity bootstrap (accounts: the
 * pre-accounts snapshot, the root secret and its fingerprint, the auth.json import, FUOBE_PASSWORD): a server
 * that must not start (a changed secret key, an unknown FUOBE_MODE) stops here with one line. Then start the
 * generation runner right away, so jobs that were in
 * flight before a restart keep advancing (and live updates flow) even when the UI only lists them.
 * Also empties what has been in the Trash for 30 days (then daily), starts Assist's scheduled tasks and Character
 * Swap Studio's sweep.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { bootstrapIdentity, StartupError } = await import("./server/identity/bootstrap");
  try {
    const report = await bootstrapIdentity();
    if (report.snapshot) console.log(`Fuobe saved a copy of the database before accounts: ${report.snapshot.db}`);
    if (report.importedPassword) console.log("Fuobe moved the password to accounts: sign in once more in each browser.");
  } catch (e) {
    console.error(e instanceof StartupError ? `Fuobe can't start: ${e.message}` : e);
    process.exit(1);
  }
  const { ensureRunner } = await import("./server/generations");
  ensureRunner();
  const { ensureTrashPurge } = await import("./server/library");
  ensureTrashPurge();
  // Faceless / Explainer renders whose narration was timed while the server was down continue with their scenes.
  const { ensureFacelessRunner } = await import("./server/faceless");
  ensureFacelessRunner();
  // Assist's scheduled tasks: a 30 s sweep starts the runs that are due (a run missed while the server was off happens once, a few seconds after boot).
  const { ensureScheduleRunner } = await import("./server/assist/schedules");
  ensureScheduleRunner({ soon: true });
  // Character Swap Studio: takes queued behind the segments they continue from launch (or stop) when those finish.
  const { ensureSwapStudioRunner } = await import("./server/swap-studio");
  ensureSwapStudioRunner();
}
