"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import type { Generation } from "@/lib/catalog/types";
import { sharePath, type ShareCreated, type ShareKind } from "@/lib/share";
import type { ShareOpen } from "./share-dialog";

// ---------------------------------------------------------------------------
// Links this browser made (the server keeps only a hash, so only the browser that made a link can copy it again)

const KEY = "fuobe.shareLinks";

function rawLinks(): string {
  try {
    return localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function parseLinks(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

function writeLinks(all: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage off (a private window): the link can't be copied again later, only renewed.
  }
  listeners.forEach((l) => l());
}

/** Remember a link's token in this browser (replacing `previousId`'s after a new link). */
export function rememberLink(id: string, token: string, previousId?: string) {
  const all = parseLinks(rawLinks());
  if (previousId) delete all[previousId];
  writeLinks({ ...all, [id]: token });
}

export function forgetLink(id: string) {
  const all = parseLinks(rawLinks());
  delete all[id];
  writeLinks(all);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** The tokens this browser made, by link id (none while rendering on the server). */
export function useRememberedLinks(): Record<string, string> {
  const raw = useSyncExternalStore(subscribe, rawLinks, () => "{}");
  return useMemo(() => parseLinks(raw), [raw]);
}

/** The full address of a link, at the address this studio is open on. */
export const shareUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}${sharePath(token)}`;

// ---------------------------------------------------------------------------
// Share and Publish from anywhere under the studio layout

export interface ShareTarget {
  kind: Exclude<ShareKind, "publish">;
  id: string;
  /** Prefills the link's title. */
  title: string;
  /** A title made from the prompt, offered instead while "Show prompts" is on. */
  promptTitle?: string;
}

interface ShareApi {
  /** Share a result, a folder or a Cinema project. */
  share: (t: ShareTarget) => void;
  /** Publish a selection (the four-step wizard). */
  publish: (items: Generation[]) => void;
  /** Show a link just made or renewed (Library → Shared's New link). */
  showLink: (created: ShareCreated) => void;
}

const ShareCtx = createContext<ShareApi | null>(null);

/** Share and Publish for every view in the studio (null outside one). */
export const useShare = () => useContext(ShareCtx);

// The dialogs (forms, the wizard, thumbnails) load the first time one opens, not with every page.
const ShareDialogs = dynamic(() => import("./share-dialog").then((m) => m.ShareDialogs), { ssr: false });

export function ShareProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<ShareOpen | null>(null);
  // After a menu has closed and handed focus back, so the dialog keeps it.
  const later = useCallback((o: ShareOpen) => setTimeout(() => setOpen(o), 0), []);
  const api = useMemo<ShareApi>(() => ({ share: (target) => later({ target }), publish: (items) => later({ publish: items }), showLink: (made) => later({ made }) }), [later]);
  return (
    <ShareCtx.Provider value={api}>
      {children}
      {open && <ShareDialogs open={open} onOpen={later} onClose={() => setOpen(null)} />}
    </ShareCtx.Provider>
  );
}
