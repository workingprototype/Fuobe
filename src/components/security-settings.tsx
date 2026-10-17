"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, LogOut, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeAgo } from "@/lib/format";

interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
}
interface AuthStatus {
  enabled: boolean;
  fromEnv: boolean;
  tokens: TokenInfo[];
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

function PasswordForm({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const run = async (password: string | null) => {
    setBusy(true);
    try {
      await call("/api/auth/password", "POST", { current: current || undefined, password });
      toast.success(password === null ? "Password removed — the studio is open again" : status.enabled ? "Password changed" : "Password set — sign-in is now required");
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <div className="space-y-3">
      {status.enabled && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-current`} className="text-[13px]">Current password</Label>
          <Input id={`${id}-current`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="w-72" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 sm:w-[36rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-new`} className="text-[13px]">{status.enabled ? "New password" : "Password"}</Label>
          <Input id={`${id}-new`} type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-repeat`} className="text-[13px]">Repeat it</Label>
          <Input id={`${id}-repeat`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        </div>
      </div>
      {mismatch && <p className="text-[12px] text-destructive">The passwords don&apos;t match</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || next.length < 8 || next !== confirm || (status.enabled && !current)} onClick={() => void run(next)}>
          {busy && <Loader2 className="animate-spin" />}
          {status.enabled ? "Change password" : "Require a password"}
        </Button>
        {status.enabled && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy || !current} onClick={() => void run(null)}>
            Remove password
          </Button>
        )}
      </div>
    </div>
  );
}

/** How to point an MCP client (Claude Code, Claude Desktop…) at this studio. */
function McpSnippet({ token, needsToken }: { token: string | null; needsToken: boolean }) {
  const [origin] = useState(() => (typeof window === "undefined" ? "http://localhost:3000" : window.location.origin));
  const auth = needsToken ? ` --header "Authorization: Bearer ${token ?? "fuobe_…"}"` : "";
  const cmd = `claude mcp add --transport http fuobe ${origin}/api/mcp${auth}`;
  return (
    <div className="space-y-1.5 sm:w-[36rem]">
      <p className="text-[12px] font-medium">Connect an agent over MCP</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">{cmd}</code>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(cmd);
            toast("Copied");
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Copy command"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Any MCP client works (streamable HTTP). It can search models, price a plan, generate and fetch results{needsToken ? " — create a token for it first" : ""}.
      </p>
    </div>
  );
}

function Tokens({ status, onChange }: { status: AuthStatus; onChange: () => void }) {
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const create = async () => {
    try {
      const r = await call<{ token: string }>("/api/auth/tokens", "POST", { name });
      setFresh(r.token);
      setName("");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-[13px]">API tokens</Label>
        <p className="text-[12px] text-muted-foreground">
          For scripts and agents (the REST API and the MCP endpoint at <code className="font-mono">/api/mcp</code>). Send as <code className="font-mono">Authorization: Bearer fuobe_…</code>. Only needed once a password is set.
        </p>
      </div>
      {fresh && (
        <div className="rounded-xl border border-primary/40 bg-brand-faint p-3">
          <p className="text-[12px] font-medium">Copy this token now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-[12px]">{fresh}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                toast("Copied");
              }}
            >
              <Copy /> Copy
            </Button>
          </div>
        </div>
      )}
      {status.tokens.length > 0 && (
        <ul className="divide-y rounded-xl border sm:w-[36rem]">
          {status.tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{t.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {t.prefix}… · created {timeAgo(t.createdAt)}
                  {t.lastUsedAt ? ` · used ${timeAgo(t.lastUsedAt)}` : " · never used"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Revoke ${t.name}`}
                onClick={async () => {
                  await call(`/api/auth/tokens?id=${t.id}`, "DELETE").catch((e) => toast.error((e as Error).message));
                  onChange();
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <McpSnippet token={fresh} needsToken={status.enabled} />
      <div className="flex gap-2 sm:w-[36rem]">
        <Input placeholder="Token name, e.g. “Claude Desktop”" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" variant="secondary" className="h-9" disabled={!name.trim()} onClick={() => void create()}>
          Create token
        </Button>
      </div>
    </div>
  );
}

export function SecuritySettings() {
  const qc = useQueryClient();
  const router = useRouter();
  const status = useQuery({ queryKey: ["auth"], queryFn: () => call<AuthStatus>("/api/auth/password", "GET") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["auth"] });
  if (!status.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const s = status.data;
  return (
    <div className="space-y-6">
      {s.enabled ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-brand-faint px-3 py-2.5 text-[13px]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-text" />
          <p className="flex-1">Sign-in is required for every page and API call.{s.fromEnv && " The password is set by FUOBE_PASSWORD on the server."}</p>
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 h-7"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
            }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>No password: anyone who can reach this server can use your keys and GPU. Fine on your own computer — set a password before you open it to a network.</p>
        </div>
      )}
      {!s.fromEnv && <PasswordForm status={s} onDone={refresh} />}
      <Tokens status={s} onChange={refresh} />
    </div>
  );
}
