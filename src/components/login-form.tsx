"use client";

import { Loader2, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewer } from "@/lib/api";
import { safeNext } from "@/lib/safe-redirect";

/** "signup" and "login" are accounts (public sign-up); "owner" is the install password. */
type Mode = "signup" | "login" | "owner";

/** On a public site the owner's sign-in isn't advertised: production builds open it at /login?owner=1. */
const OWNER_LINK = process.env.NODE_ENV !== "production";

const COPY: Record<Mode, { title: string; lead: string; button: string }> = {
  signup: { title: "Create your free account", lead: "An email and a password, and you're in. No verification.", button: "Sign up" },
  login: { title: "Welcome back", lead: "Log in with your email and password.", button: "Log in" },
  owner: { title: "Welcome back", lead: "This Fuobe studio is password protected.", button: "Sign in" },
};

export function LoginForm() {
  const params = useSearchParams();
  const viewer = useViewer();
  const open = !!viewer.data?.publicSignup;
  const [chosen, setChosen] = useState<Mode | null>(null);
  const mode: Mode = !open ? "owner" : (chosen ?? (params.get("owner") === "1" ? "owner" : params.get("signup") === "1" ? "signup" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"), typeof window === "undefined" ? "http://localhost" : window.location.origin);

  const choose = (m: Mode) => {
    setChosen(m);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const url = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const body = mode === "owner" ? { password } : { email, password };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      // Only a page on this site: never bounce to another origin after signing in.
      window.location.assign(safeNext(params.get("next"), window.location.origin));
      return;
    }
    setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in");
    setBusy(false);
  };

  if (viewer.isPending) {
    return (
      <div className="grid h-72 w-full max-w-sm place-items-center rounded-2xl border bg-background shadow-soft">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const copy = COPY[mode];
  const short = mode === "signup" && password.length > 0 && password.length < 8;
  return (
    <form onSubmit={submit} className="w-full max-w-sm animate-fade-up rounded-2xl border bg-background p-7 shadow-soft">
      <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
        {mode === "signup" ? <Sparkles className="size-5" /> : <Lock className="size-5" />}
      </div>
      <h1 className="font-heading text-[28px] leading-tight">{copy.title}</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{copy.lead}</p>
      {mode !== "owner" && (
        <Input
          type="email"
          autoFocus
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-5 h-11"
          aria-invalid={!!error}
        />
      )}
      <Input
        type="password"
        autoFocus={mode === "owner"}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder={mode === "signup" ? "Password (at least 8 characters)" : "Password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={mode === "owner" ? "mt-5 h-11" : "mt-2.5 h-11"}
        aria-invalid={!!error || short}
      />
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      <Button type="submit" className="mt-4 h-11 w-full" disabled={!password || (mode !== "owner" && !email) || (mode === "signup" && password.length < 8) || busy}>
        {busy && <Loader2 className="animate-spin" />} {copy.button}
      </Button>
      {open && (
        <div className="mt-4 space-y-1.5 text-center text-[13px] text-muted-foreground">
          {mode === "signup" ? (
            <p>
              Have an account?{" "}
              <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => choose("login")}>
                Log in
              </button>
            </p>
          ) : (
            <p>
              New here?{" "}
              <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => choose("signup")}>
                Create a free account
              </button>
            </p>
          )}
          <p>
            <Link href={next} className="underline-offset-4 hover:underline">
              Keep browsing as a guest
            </Link>
            {OWNER_LINK && mode !== "owner" && (
              <>
                {" · "}
                <button type="button" className="underline-offset-4 hover:underline" onClick={() => choose("owner")}>
                  Studio owner
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </form>
  );
}
