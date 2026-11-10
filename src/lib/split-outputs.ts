import type { GenerationRequest } from "./catalog/types";

/**
 * The request one run of a split keeps. A request for more pictures than one run of its graph makes is split one run per
 * picture (or group of `perJob`): each run's request says what that run makes (`params.numOutputs`: its tile's
 * placeholders, Retry and the Library read it) and keeps the number asked for (`askedOutputs`: Reuse reads it). A run
 * that isn't split keeps its request as it was.
 */
export function splitRunRequest<R extends GenerationRequest>(request: R, jobs: number, perJob: number): R {
  const asked = request.params?.numOutputs ?? 1;
  if (jobs <= 1 || asked <= perJob) return request;
  return { ...request, askedOutputs: asked, params: { ...request.params, numOutputs: perJob } };
}

/** The number of pictures Reuse brings back to the composer: the number asked for when the run was one of a split. */
export function reuseOutputs(request: Pick<GenerationRequest, "askedOutputs" | "params">): number | undefined {
  const own = request.params?.numOutputs;
  return request.askedOutputs && request.askedOutputs > (own ?? 1) ? request.askedOutputs : own;
}
