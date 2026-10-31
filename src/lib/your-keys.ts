import { FAL_KEYS_URL } from "./connections";

/**
 * Your keys (public sign-up): an account's own fal.ai key or Replicate token, so it can run paid models billed to its own
 * account with that provider, never to the studio (src/server/account-keys.ts, src/server/provider-keys.ts). The names,
 * links and words the server and the browser share. Never a key.
 */

export type CloudProvider = "fal" | "replicate";

export const CLOUD_PROVIDERS: readonly CloudProvider[] = ["fal", "replicate"];

export const isCloudProvider = (p: unknown): p is CloudProvider => p === "fal" || p === "replicate";

/** Where to make a Replicate API token. */
export const REPLICATE_TOKENS_URL = "https://replicate.com/account/api-tokens";

export const CLOUD_KEY: Record<
  CloudProvider,
  { label: string; field: string; setting: "falKey" | "replicateToken"; placeholder: string; keysUrl: string; getKey: string; blurb: string }
> = {
  fal: { label: "fal.ai", field: "fal.ai API key", setting: "falKey", placeholder: "key_id:key_secret", keysUrl: FAL_KEYS_URL, getKey: "Get a key", blurb: "One key runs almost every paid model." },
  replicate: { label: "Replicate", field: "Replicate API token", setting: "replicateToken", placeholder: "r8_…", keysUrl: REPLICATE_TOKENS_URL, getKey: "Get a token", blurb: "Hosts some of the same models." },
};

/** What Settings → Your keys shows of a saved key: never the key itself. */
export interface KeyInfo {
  last4: string;
  addedAt: number;
  /** False when this server can't open it any more (its server key was lost): add it again. */
  readable: boolean;
  /** When the provider refused it in a run. */
  rejectedAt?: number;
}

/** GET /api/account/keys. */
export interface YourKeys {
  keys: Record<CloudProvider, KeyInfo | null>;
  /** "both" while it has a usable key and the studio isn't open-source only. */
  engineMode: "open" | "both";
  /** The studio lets accounts use paid models with their own keys (it isn't open-source only). */
  paidAllowed: boolean;
}

/** Set on an account's refused run (its value: fal or replicate): the client opens "Add your key". */
export const ADD_KEY_HEADER = "x-fuobe-add-key";

export const addKeyMessage = (p: CloudProvider) => `Add your ${CLOUD_KEY[p].label} key to run this. Runs on ${CLOUD_KEY[p].label} are billed to your own ${CLOUD_KEY[p].label} account.`;
export const keyRejectedMessage = (p: CloudProvider) => `${CLOUD_KEY[p].label} didn't accept your key. Check it in Settings → Your keys.`;
export const balanceMessage = (p: CloudProvider) => `Your ${CLOUD_KEY[p].label} balance has run out. Top it up on ${CLOUD_KEY[p].label}, then run again.`;
export const keyRemovedMessage = (p: CloudProvider) => `Your ${CLOUD_KEY[p].label} key was removed, so this run stopped.`;
/** The owner (or anyone not signed in as an account) on /api/account/keys. */
export const NOT_ACCOUNT_KEYS = "Your keys are for accounts. The studio's own keys are in Settings → Paid API configuration.";
export const OPEN_ONLY_MESSAGE = "This studio runs open-source models only right now, so your keys aren't used.";
