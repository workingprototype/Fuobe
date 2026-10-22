import { toast } from "sonner";

/**
 * Copy text to the clipboard, also where the Clipboard API is missing: a self-hosted Fuobe opened
 * over plain http on a LAN address is not a secure context, so `navigator.clipboard` is undefined
 * there. Falls back to selecting a hidden textarea and `document.execCommand("copy")`.
 * Resolves to whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not focused: try the fallback.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // Off-screen but still selectable (display: none can't be selected).
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    active?.focus?.();
  }
}

/**
 * Copy and say how it went: `done` ("Prompt copied") when it worked, a hint to copy by hand when
 * the browser refused (the same feedback on every Copy button).
 */
export async function copyWithToast(text: string, done = "Copied"): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast(done, { duration: 1500 });
  else toast.error("Couldn’t copy — select the text and copy it instead");
  return ok;
}
