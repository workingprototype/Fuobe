"use client";

import { Loader2, Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only same-site paths: never bounce to another origin after signing in.
  const next = (() => {
    const n = params.get("next") ?? "/";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/";
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.assign(next);
      return;
    }
    setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm animate-fade-up rounded-2xl border bg-background p-7 shadow-soft">
      <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Lock className="size-5" />
      </div>
      <h1 className="font-heading text-[28px] leading-tight">Welcome back</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">This Fuobe studio is password protected.</p>
      <Input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-5 h-11"
        aria-invalid={!!error}
      />
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      <Button type="submit" className="mt-4 h-11 w-full" disabled={!password || busy}>
        {busy && <Loader2 className="animate-spin" />} Sign in
      </Button>
    </form>
  );
}
