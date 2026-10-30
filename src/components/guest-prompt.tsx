"use client";

import { Cpu, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { YourGpu } from "@/components/gpu/your-gpu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONNECT_GPU_EVENT, GUEST_PROMPT_EVENT, signInHref, watchGuestRefusals } from "@/lib/api";

type Prompt = { kind: "guest"; here: string } | { kind: "gpu" };

/**
 * The cards a public studio shows when something is refused (watchGuestRefusals): "Create a free
 * account to run this" for a guest (public sign-up, signed out) who tries to generate, upload or
 * change anything, and "Connect your GPU to run this" for an account (accounts run only on their
 * own ComfyUI, never the owner's keys or GPU). Mounted once, in the app's providers.
 */
export function GuestPrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  useEffect(() => {
    watchGuestRefusals();
    const guest = () => setPrompt({ kind: "guest", here: window.location.pathname + window.location.search });
    const gpu = () => setPrompt({ kind: "gpu" });
    window.addEventListener(GUEST_PROMPT_EVENT, guest);
    window.addEventListener(CONNECT_GPU_EVENT, gpu);
    return () => {
      window.removeEventListener(GUEST_PROMPT_EVENT, guest);
      window.removeEventListener(CONNECT_GPU_EVENT, gpu);
    };
  }, []);
  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
      <DialogContent className={prompt?.kind === "gpu" ? "max-h-[90svh] overflow-y-auto sm:max-w-xl" : "sm:max-w-sm"}>
        {prompt?.kind === "gpu" ? (
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
                <Link href={signInHref("signup", prompt?.here)}>Sign up free</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={signInHref("login", prompt?.here)}>Log in</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
