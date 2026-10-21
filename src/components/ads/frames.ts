"use client";

import { uploadFile } from "@/lib/api";

/** Resolve on an element event, or reject after `ms` (a clip the browser can't decode never fires). */
function once(el: HTMLMediaElement, event: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => (cleanup(), reject(new Error("timeout"))), ms);
    const ok = () => (cleanup(), resolve());
    const bad = () => (cleanup(), reject(new Error("unreadable")));
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

/** One frame of a (same-origin) clip at `t` seconds, as a JPEG; null when this browser can't read it. */
export async function grabFrame(src: string, t: number): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = src;
  try {
    await once(v, "loadeddata");
    const at = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.05));
    if (Math.abs(v.currentTime - at) > 0.01) {
      const seeked = once(v, "seeked");
      v.currentTime = at;
      await seeked;
    }
    if (!v.videoWidth || !v.videoHeight) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

/** Grab a frame and upload it; resolves the /api/files URL, or undefined (the server falls back). */
export async function uploadFrame(src: string, t: number, name: string): Promise<string | undefined> {
  const blob = await grabFrame(src, t);
  if (!blob) return undefined;
  try {
    return (await uploadFile(new File([blob], `${name}.jpg`, { type: "image/jpeg" }))).url;
  } catch {
    return undefined;
  }
}
