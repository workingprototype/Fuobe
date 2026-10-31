"use client";

import { Cpu, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { YourGpu } from "@/components/gpu/your-gpu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONNECT_GPU_EVENT, GUEST_PROMPT_EVENT, refusalCard, signInHref, watchGuestRefusals, type RefusalCard } from "@/lib/api";

/**
 * The cards a public studio shows when something is refused (watchGuestRefusals): "Create a free
 * account to run this" for a guest (public sign-up, signed out) who tries to generate, upload or
 * change anything, and "Connect your GPU to run this" for an account (accounts run only on their
 * own ComfyUI, never the owner's keys or GPU). Mounted once, in the app's providers, so it outlives
 * the page: a card closes when the page changes (its own Sign up or Log in, Back), and never opens
 * on the sign-in page (refusalCard).
 */
export function GuestPrompt() {
  // The last card stays while the dialog animates out.
  const [card, setCard] = useState<RefusalCard | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    watchGuestRefusals();
    const show = (kind: RefusalCard["kind"]) => {
      const next = refusalCard(kind, window.location);
      if (!next) return;
      setCard(next);
      setOpen(true);
    };
    const guest = () => show("guest");
    const gpu = () => show("gpu");
    window.addEventListener(GUEST_PROMPT_EVENT, guest);
    window.addEventListener(CONNECT_GPU_EVENT, gpu);
    return () => {
      window.removeEventListener(GUEST_PROMPT_EVENT, guest);
      window.removeEventListener(CONNECT_GPU_EVENT, gpu);
    };
  }, []);
  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigation close={close} />
      </Suspense>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className={card?.kind === "gpu" ? "max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl" : "sm:max-w-sm"}>
          {card?.kind === "gpu" ? (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Cpu className="size-5" />
                </div>
                <DialogTitle>Connect your GPU to run this</DialogTitle>
                <DialogDescription>
                  Or run Fuobe on your own computer: it&apos;s{" "}
                  <a href="https://github.com/workingprototype/fuobe" target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    open source
                  </a>
                  .
                </DialogDescription>
              </DialogHeader>
              <YourGpu />
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Sparkles className="size-5" />
                </div>
                <DialogTitle>Create a free account to run this</DialogTitle>
                <DialogDescription>You&apos;re browsing as a guest. Sign up with an email and a password to generate, upload and keep your work.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:justify-start">
                <Button asChild>
                  <Link href={signInHref("signup", card?.here)} onClick={close}>
                    Sign up free
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={signInHref("login", card?.here)} onClick={close}>
                    Log in
                  </Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Closes the card when the page changes. Reads the path (runtime data), so it sits under Suspense: routes still prerender. */
function CloseOnNavigation({ close }: { close: () => void }) {
  const pathname = usePathname();
  useEffect(() => close(), [pathname, close]);
  return null;
}
