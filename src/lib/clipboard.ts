import { toast } from "sonner";

/**
 * Copy text to the clipboard, also where the Clipboard API is missing: a self-hosted Fuobe opened
 * over plain http on a LAN address is not a secure context, so `navigator.clipboard` is undefined
 * there. Falls back to `document.execCommand("copy")` (see legacyCopy). Resolves to whether the
 * text was copied.
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

/** Containers that trap the focus (Radix dialogs, sheets, popovers and menus). */
const FOCUS_TRAPS = '[role="dialog"],[role="alertdialog"],[role="menu"]';

/**
 * Where the hidden textarea goes: inside the dialog or menu that holds the focus. Most Copy buttons
 * sit in one (the feed's ⋯ menu, the viewer), and its focus trap pulls the focus straight back out
 * of a textarea on <body>, so the copy would find nothing selected.
 */
function hostFor(active: Element | null): Element {
  if (!active || active === document.body || active === document.documentElement) return document.body;
  return active.closest?.(FOCUS_TRAPS) ?? active.parentElement ?? document.body;
}

/**
 * execCommand("copy") from the click that asked for it. Its copy event carries the text itself
 * (clipboardData), so the copy doesn't depend on a selection surviving; the selected textarea
 * backs that up for a browser without clipboardData. Only says it worked when one of them held:
 * execCommand returns true even when it copied nothing.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  // Off-screen but still selectable (display: none can't be selected).
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none";
  let wrote = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    wrote = true;
  };
  hostFor(active).appendChild(ta);
  document.addEventListener("copy", onCopy, true);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    return ok && (wrote || (document.activeElement === ta && ta.selectionEnd - ta.selectionStart === text.length));
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    ta.remove();
    active?.focus?.({ preventScroll: true });
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
