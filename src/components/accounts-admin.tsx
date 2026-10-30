"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Trash2, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useViewer } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface AccountRow {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
  disabled: boolean;
  gpu: boolean;
}

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

/** Settings → Accounts (the owner only): who signed up (public sign-up), with switch-off, delete and a CSV export. */
export function AccountsAdmin() {
  const owner = useViewer().data?.owner;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-accounts"], queryFn: () => call<{ total: number; items: AccountRow[] }>("/api/admin/accounts"), enabled: !!owner });
  if (!owner || !q.data) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-accounts"] });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      refresh();
    }
  };
  const { total, items } = q.data;
  return (
    <section id="accounts" aria-labelledby="accounts-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-t py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="accounts-title" className="text-[15px] font-semibold">
          Accounts
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {total} {total === 1 ? "person has" : "people have"} signed up (Settings → Security → Public sign-up). Accounts never see your library or use your keys and GPU.
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary" disabled={!total}>
            <a href="/api/admin/accounts?format=csv" download>
              <Download /> Export CSV
            </a>
          </Button>
          {q.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {items.length > 0 && (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Last login</th>
                  <th className="px-3 py-2 font-medium">GPU</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((a) => (
                  <tr key={a.id} className={a.disabled ? "text-muted-foreground" : undefined}>
                    <td className="max-w-56 truncate px-3 py-2 font-medium">
                      {a.email}
                      {a.disabled && <span className="ml-1.5 rounded-sm bg-muted px-1 py-0.5 text-[10px] font-normal">off</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{timeAgo(a.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{a.lastLoginAt ? timeAgo(a.lastLoginAt) : "—"}</td>
                    <td className="px-3 py-2">{a.gpu ? "Connected" : "—"}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground"
                        aria-label={a.disabled ? `Switch ${a.email} on` : `Switch ${a.email} off`}
                        title={a.disabled ? "Switch on" : "Switch off"}
                        onClick={() => void act(() => call(`/api/admin/accounts/${a.id}`, "PATCH", { disabled: !a.disabled }), a.disabled ? "Switched on" : "Switched off")}
                      >
                        {a.disabled ? <UserCheck className="size-3.5" /> : <UserX className="size-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${a.email}`}
                        title="Delete"
                        onClick={() => {
                          if (window.confirm(`Delete the account ${a.email}?`)) void act(() => call(`/api/admin/accounts/${a.id}`, "DELETE"), "Account deleted");
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
