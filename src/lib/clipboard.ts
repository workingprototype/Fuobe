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
