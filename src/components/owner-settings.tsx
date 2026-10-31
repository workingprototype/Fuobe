"use client";

import { Info, Loader2, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInHref, useHydrated, useViewer } from "@/lib/api";

/** Settings' line under its title: what this viewer finds on the page. Nothing until the viewer is known (as below). */
export function SettingsIntro() {
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner)
    return "Choose open source, paid APIs or both, connect providers, point Fuobe at your ComfyUI server, and choose how prompts get enhanced. Keys stay on this server.";
  return v.account ? "Your account and your GPU. The studio's own settings, keys and tokens are its owner's." : "Create a free account and connect your own GPU.";
}

/**
 * The install's settings, for its owner only. A guest (public sign-up) is offered an account, which
 * connects its own GPU here; an account sees Your GPU (AccountGpuSection) and its account, nothing of the install's.
 * Both can read the licences.
 */
export function OwnerSettings({ children }: { children: React.ReactNode }) {
  // The server renders nothing here (it doesn't know the viewer), so hydration must too, even when the browser's
  // viewer query has already answered (a component outside this page's boundary asked first).
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner) return <>{children}</>;
  return (
    <>
      {v.account ? (
        <AccountSection email={v.account.email} />
      ) : (
        <section className="space-y-3 border-b py-8">
          <h2 className="text-[15px] font-semibold">Run Fuobe on your own GPU</h2>
          <p className="max-w-xl text-[13px] text-muted-foreground">
            Create a free account, then connect your own ComfyUI: your runs go to your GPU. It must be reachable from the internet, for example through a Cloudflare Tunnel or ngrok.
          </p>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={signInHref("signup", "/settings#your-gpu")}>Sign up free</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={signInHref("login", "/settings#your-gpu")}>Log in</Link>
            </Button>
          </div>
        </section>
      )}
      <Licences />
    </>
  );
}

const linkCard = "inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors hover:bg-accent";

/** The licence pages, which everyone may read (the owner finds them in the settings form). */
function Licences() {
  return (
    <section aria-labelledby="licences-title" className="grid grid-cols-[minmax(0,1fr)] gap-4 py-8 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="licences-title" className="text-[15px] font-semibold">
          Licences
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Every model&apos;s licence, Fuobe&apos;s own, and the notices the open models ask for.</p>
      </div>
      <div className="flex flex-wrap content-start gap-2">
        <Link href="/settings/models" className={linkCard}>
          <Scale className="size-4 text-muted-foreground" /> Models &amp; licences
        </Link>
        <Link href="/settings/about" className={linkCard}>
          <Info className="size-4 text-muted-foreground" /> About &amp; licences
        </Link>
      </div>
    </section>
  );
}

/** An account's own: deleting it (its password again, DELETE /api/auth/me) takes its runs, files and GPU with it. */
function AccountSection({ email }: { email: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.status === 204) {
        // A full load: the page and every cached answer were the account's.
        window.location.replace(window.location.origin);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `The account wasn't deleted (${res.status})`);
    } catch {
      setError("The account wasn't deleted: the studio didn't answer. Try again.");
    }
    setBusy(false);
  };
  return (
    <section id="account" aria-labelledby="account-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-4 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="account-title" className="text-[15px] font-semibold">
          Account
        </h2>
        <p className="mt-1 text-[13px] [overflow-wrap:anywhere] text-muted-foreground">{email}</p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="max-w-xl text-[13px] text-muted-foreground">Deleting your account removes your uploads, your runs and their files, and your GPU connection, and signs you out. It can&apos;t be undone.</p>
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete account
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          setPassword("");
          setError("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={remove} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                {email} and everything you made with it go for good. Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-password`} className="text-[13px]">
                Password
              </Label>
              <Input
                id={`${id}-password`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                autoFocus
              />
              {error && (
                <p id={`${id}-error`} role="alert" className="text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={busy || !password}>
                {busy && <Loader2 className="animate-spin" />}
                Delete account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
