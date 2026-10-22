import type { GenInput, MediaKind, ModelDef, ModelRoute, ProviderId } from "@/lib/catalog/types";

export interface SubmitContext {
  generationId: string;
  model: ModelDef;
  route: ModelRoute;
  input: GenInput;
}

export interface SubmitResult {
  externalId: string;
  /** Provider-specific state needed for polling (status URLs, client ids...). */
  meta?: Record<string, unknown>;
  /** The exact payload sent, stored for debugging/reproducibility. */
  payload?: unknown;
}

export interface RemoteOutput {
  url: string;
  draftId?: string;
  kind?: MediaKind;
  contentType?: string;
  /** Text results (transcripts): the content; `url` is then a data:text/plain URI holding the same text. */
  text?: string;
  /** Structured extras for OutputFile.meta (layer name/z/bbox, cues, textBlocks, stem, 3D preview…). */
  meta?: Record<string, unknown>;
  /** Extra headers needed to download (e.g. auth for a private ComfyUI). */
  headers?: Record<string, string>;
}

export type PollResult =
  | { state: "queued"; progress?: number; message?: string }
  | { state: "running"; progress?: number; message?: string }
  | { state: "succeeded"; outputs: RemoteOutput[]; message?: string }
  | { state: "failed"; error: string };

export interface PollContext {
  externalId: string;
  meta: Record<string, unknown>;
  route: ModelRoute;
  model: ModelDef;
  createdAt: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  isConfigured(): boolean;
  /**
   * Turn a local file into something the provider accepts (URL, data URI, uploaded filename). `route` is
   * the route the file is for (ComfyUI uploads an isolated-worker workflow's inputs to that worker).
   */
  prepareFile(data: Buffer, contentType: string, name: string, route?: ModelRoute): Promise<string>;
  submit(ctx: SubmitContext): Promise<SubmitResult>;
  poll(ctx: PollContext): Promise<PollResult>;
  cancel?(ctx: PollContext): Promise<void>;
  /** Lightweight connectivity check for the settings page. */
  test?(): Promise<{ ok: boolean; detail: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
