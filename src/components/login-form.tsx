"use client";

import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNext } from "@/lib/safe-redirect";
import { refusalMessage } from "@/lib/sign-in-refusals";

/**
 * The Personal sign-in card (docs/research/accounts-8-screens.md §S2.1): one password field, never an email. A
 * refusal the proxy sent here (?code=) shows above the field. After signing in the page loads in full, so nothing
 * from before stays in memory.
 */
export function LoginForm({ installName }: { installName: string }) {
  const params = useSearchParams();
  const id = useId();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("code");
    return code ? refusalMessage(code, { name: installName }) : null;
  });
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }).catch(() => null);
    if (res?.ok) {
      // Only a page on this site: never bounce to another origin after signing in.
      window.location.assign(safeNext(params.get("next"), window.location.origin));
      return;
    }
    setError(res ? (((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in. Try again.") : "Can't reach Fuobe. Check your connection and try again.");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm animate-fade-up rounded-2xl border bg-background p-7 shadow-soft max-[400px]:p-6">
      <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Lock className="size-5" aria-hidden />
      </div>
      <h1 className="font-heading text-[28px] leading-tight">Welcome back</h1>
      <p className="mt-1 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">Sign in to {installName}.</p>
      <Label htmlFor={`${id}-password`} className="mt-5 text-[13px]">
        Password
      </Label>
      <div className="relative mt-1.5">
        <Input
          id={`${id}-password`}
          type={shown ? "text" : "password"}
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 pr-11"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          // One fixed name with a pressed state: "Show password, toggle button, pressed" (a swapping name would
          // announce two states at once).
          aria-pressed={shown}
          aria-label="Show password"
          aria-controls={`${id}-password`}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-4 h-11 w-full" disabled={!password || busy}>
        {busy && <Loader2 className="animate-spin" />} Sign in
      </Button>
      <button type="button" onClick={() => setForgot((f) => !f)} aria-expanded={forgot} aria-controls={`${id}-forgot`} className="mt-4 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Forgot password?
      </button>
      <p id={`${id}-forgot`} hidden={!forgot} className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        On the computer where Fuobe runs, start it again with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">FUOBE_PASSWORD</code> set to a new password. That password works right away, and every browser signs in again.
      </p>
    </form>
  );
}
