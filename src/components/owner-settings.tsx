"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Heart, KeyRound, Loader2, LogOut, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { GitHubMark } from "@/components/github-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OAuthButtons } from "@/components/oauth-buttons";
import { useHashAnchor } from "@/components/use-hash-anchor";
import { announceAuthChange, leaveNotice, rememberViewer, signInHref, signOut, useHydrated, useViewer, type OAuthProviderId, type ViewerInfo } from "@/lib/api";
import { FUOBE_REPO } from "@/lib/connections";
import { cn } from "@/lib/utils";

/** Settings' line under its title: what this viewer finds on the page. Nothing until the viewer is known (as below). */
export function SettingsIntro() {
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner)
    return "Choose open source, paid APIs or both, connect providers, point Fuobe at your ComfyUI server, and choose how prompts get enhanced. Keys stay on this server.";
  return v.account ? "Your account, your GPU and your keys." : "Connect your GPU, and see the open models and code Fuobe is built on.";
}

/**
 * The install's settings, for its owner only. A guest (public sign-up) is offered an account, which
 * connects its own GPU here; an account sees Your GPU (AccountGpuSection) and its account, nothing of the install's.
 * Both can read Thanks & licences.
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
        <AccountSection account={v.account} />
      ) : (
        <section className="space-y-3 border-b py-8">
          <h2 className="text-[15px] font-semibold">Run Fuobe on your own GPU</h2>
          <p className="max-w-xl text-[13px] text-pretty text-muted-foreground">
            Create a free account, connect the ComfyUI on your computer, and make as much as you like, free.
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

/**
 * About's links: Thanks & licences and the source on GitHub for everyone, and the owner's Models & licences (its
 * switches; also its own section of the settings form).
 */
export function AboutLinks({ owner }: { owner?: boolean }) {
  return (
    <div className="flex flex-wrap content-start gap-2">
      <Link href="/settings/licences" className={linkCard}>
        <Heart className="size-4 text-muted-foreground" /> Thanks &amp; licences
      </Link>
      {owner && (
        <Link href="/settings/models" className={linkCard}>
          <Scale className="size-4 text-muted-foreground" /> Models &amp; licences
        </Link>
      )}
      <a href={FUOBE_REPO} target="_blank" rel="noreferrer" className={linkCard}>
        <GitHubMark className="size-4 text-muted-foreground" /> Source on GitHub
      </a>
    </div>
  );
}

/** About, which everyone may read (the owner finds it in the settings form). */
function Licences() {
  return (
    <section id="about" aria-labelledby="about-title" className="grid grid-cols-[minmax(0,1fr)] gap-4 py-8 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="about-title" className="text-[15px] font-semibold">
          About
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">The open models, LoRAs and code Fuobe is built on, who made them and their licences, and Fuobe&rsquo;s own source code.</p>
      </div>
      <AboutLinks />
    </section>
  );
}

/** Where an account made with Google or GitHub signs in again before it sets a password or deletes itself. */
const ACCOUNT_AGAIN = "/settings#account";

/** The answer's 403 `sign-in-again` (an account with no password, signed in a while ago): the provider to offer. */
async function signInAgainOf(res: Response): Promise<{ error?: string; provider?: OAuthProviderId }> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; provider?: string };
  const provider = body.code === "sign-in-again" && (body.provider === "google" || body.provider === "github") ? body.provider : undefined;
  return { error: body.error, provider };
}

/**
 * An account's own: changing its password (or setting its first one, when it was made with Google or GitHub), signing
 * out, and deleting it (its password again, or a recent sign-in with its provider: DELETE /api/auth/me), which takes
 * its runs, files and GPU with it.
 */
function AccountSection({ account }: { account: NonNullable<ViewerInfo["account"]> }) {
  const { email } = account;
  const noPassword = !!account.noPassword;
  const id = useId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The password was wrong (403): only then is its field marked, not for "too many tries" or no answer.
  const [wrong, setWrong] = useState(false);
  // No password, and the sign-in was a while ago: the provider to continue with first.
  const [again, setAgain] = useState<OAuthProviderId | undefined>();
  // A link to /settings#account arrives before this section exists: it is scrolled to once it does.
  useHashAnchor("account", true);
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setWrong(false);
    setAgain(undefined);
    try {
      const res = await fetch("/api/auth/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(noPassword ? {} : { password }) });
      if (res.status === 204) {
        // This browser's other tabs hear it, then a full load (as a guest's): the page and every cached answer were the
        // account's. The home page says it was deleted, which a sign-out alone would look the same as.
        rememberViewer("guest");
        leaveNotice("account-deleted");
        announceAuthChange();
        window.location.replace(window.location.origin);
        return;
      }
      if (res.status === 401) {
        // This browser was signed out (the password was changed in another one): the page shows Log in instead.
        setBusy(false);
        setOpen(false);
        setPassword("");
        toast("You were signed out", { description: "Log in again to delete your account." });
        void qc.invalidateQueries({ queryKey: ["viewer"] });
        void qc.invalidateQueries({ queryKey: ["status"] });
        announceAuthChange();
        return;
      }
      const body = await signInAgainOf(res);
      setError(body.error ?? `The account wasn't deleted (${res.status})`);
      setAgain(body.provider);
      setWrong(res.status === 403 && !noPassword);
    } catch {
      setError("We couldn't reach Fuobe. Check your connection and try again.");
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
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
            <KeyRound /> {noPassword ? "Set a password" : "Change password"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
        <div className="space-y-2">
          <p className="max-w-xl text-[13px] text-pretty text-muted-foreground">
            Deleting your account removes your uploads, your runs and their files, your GPU connection and your saved fal.ai and Replicate keys, and signs you out. It can&apos;t
            be undone.
          </p>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
            <Trash2 /> Delete account
          </Button>
        </div>
      </div>
      <ChangePassword email={email} first={noPassword} open={changing} onOpenChange={setChanging} />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          setPassword("");
          setError("");
          setWrong(false);
          setAgain(undefined);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={remove} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                {email} and everything you made with it go for good.{noPassword ? "" : " Enter your password to confirm."}
              </DialogDescription>
            </DialogHeader>
            {noPassword ? (
              error && (
                <div className="space-y-3">
                  <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
                    {error}
                  </p>
                  {again && <OAuthButtons providers={[again]} next={ACCOUNT_AGAIN} mode="login" size="sm" />}
                </div>
              )
            ) : (
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
                  aria-invalid={wrong}
                  aria-describedby={error ? `${id}-error` : undefined}
                  autoFocus
                />
                {error && (
                  <p id={`${id}-error`} role="alert" className="text-[12px] text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={busy || (!noPassword && !password)}>
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

/** A password field with a button that shows what was typed (as on the sign-in page). */
function PasswordInput({ id, shown, onShow, ...props }: React.ComponentProps<typeof Input> & { id: string; shown: boolean; onShow: () => void }) {
  return (
    <div className="relative">
      <Input id={id} type={shown ? "text" : "password"} className="pr-10" {...props} />
      <button
        type="button"
        onClick={onShow}
        aria-label="Show password"
        aria-pressed={shown}
        aria-controls={id}
        className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Settings → Account → Change password (PATCH /api/auth/me): the current password, then the new one. Every other
 * browser signed in to the account is signed out; this one stays signed in. `first`: an account made with Google or
 * GitHub sets its first password (no current one; the server asks for a recent sign-in with the provider instead).
 */
function ChangePassword({ email, first, open, onOpenChange }: { email: string; first: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The current password was wrong (403): only then is its field marked, not for "too many tries" or no answer.
  const [wrong, setWrong] = useState(false);
  const [again, setAgain] = useState<OAuthProviderId | undefined>();
  const short = next.length > 0 && next.length < 8;
  const reset = () => {
    setCurrent("");
    setNext("");
    setShown(false);
    setError("");
    setWrong(false);
    setAgain(undefined);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setWrong(false);
    setAgain(undefined);
    try {
      const res = await fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: first ? "" : current, next }) });
      if (res.ok) {
        toast.success(first ? "Password set" : "Password changed", {
          description: first ? "You can now log in with your email and this password too." : "You're still signed in here. Any other browser signed in to your account is signed out.",
        });
        reset();
        onOpenChange(false);
        if (first) void qc.invalidateQueries({ queryKey: ["viewer"] });
      } else if (res.status === 401) {
        // This browser was signed out (the password was changed in another one): the page shows Log in instead.
        setBusy(false);
        reset();
        onOpenChange(false);
        toast("You were signed out", { description: "Log in again to change your password." });
        void qc.invalidateQueries({ queryKey: ["viewer"] });
        void qc.invalidateQueries({ queryKey: ["status"] });
        announceAuthChange();
        return;
      } else {
        const body = await signInAgainOf(res);
        setError(body.error ?? `The password wasn't changed (${res.status})`);
        setAgain(body.provider);
        setWrong(res.status === 403 && !first);
      }
    } catch {
      setError("We couldn't reach Fuobe. Check your connection and try again.");
    }
    setBusy(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
        reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{first ? "Set a password" : "Change your password"}</DialogTitle>
            <DialogDescription>
              {first
                ? "Then you can log in with your email and this password as well. You stay signed in here."
                : "Changing your password signs out every other browser where you're signed in. You stay signed in here."}
            </DialogDescription>
          </DialogHeader>
          {/* The account's email, for password managers: they update its saved login rather than save a new one. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          {!first && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-current`} className="text-[13px]">
                Current password
              </Label>
              <PasswordInput
                id={`${id}-current`}
                shown={shown}
                onShow={() => setShown((s) => !s)}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={wrong}
                aria-describedby={error ? `${id}-error` : undefined}
                autoFocus
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new`} className="text-[13px]">
              New password
            </Label>
            <PasswordInput
              id={`${id}-new`}
              shown={shown}
              onShow={() => setShown((s) => !s)}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoFocus={first}
              aria-invalid={short}
              aria-describedby={`${id}-hint`}
            />
            <p id={`${id}-hint`} className={cn("text-[12px]", short ? "text-destructive" : "text-muted-foreground")}>
              {short ? `At least 8 characters (${8 - next.length} more)` : "At least 8 characters"}
            </p>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          {again && <OAuthButtons providers={[again]} next={ACCOUNT_AGAIN} mode="login" size="sm" />}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || (!first && !current) || next.length < 8}>
              {busy && <Loader2 className="animate-spin" />}
              {first ? "Set password" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
