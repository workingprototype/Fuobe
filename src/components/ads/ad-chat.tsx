"use client";

import { ArrowUp, AtSign, Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BrandKit, Product } from "@/lib/catalog/marketing";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBrandChat, useEstimate, useStatusFlags, type ChatMessage } from "@/components/marketing/hooks";

const NAME_KEY = "fuobe:first-name";
const CHIPS = ["A lifestyle ad with the product in everyday use", "A clean studio shot with a bold headline", "A playful, colorful ad for social media"];
const PLACEHOLDERS = ["Generate 4 ads for my product…", "Change the background to a holiday setting for our winter sale…", "Make 4 ad variations to A/B test…", "Write 5 versions with different headlines and CTAs…", "Tag your product with @…"];

const nameListeners = new Set<() => void>();
function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function useFirstName(): [string, (n: string) => void] {
  const name = useSyncExternalStore(
    (cb) => {
      nameListeners.add(cb);
      return () => nameListeners.delete(cb);
    },
    readName,
    () => "",
  );
  return [
    name,
    (n: string) => {
      try {
        localStorage.setItem(NAME_KEY, n.trim());
      } catch {}
      nameListeners.forEach((l) => l());
    },
  ];
}

function Proposal({ msg, brand, products, engine, onConfirmed }: { msg: ChatMessage; brand: BrandKit; products: Product[]; engine: "cloud" | "open"; onConfirmed: (batchId: string) => void }) {
  const { confirm } = useBrandChat(brand.id);
  const { higgsfield } = useStatusFlags();
  const p = msg.proposal!;
  const total = p.items.reduce((n, i) => n + i.count, 0);
  const est = useEstimate<{ costUsd: number | null; demo: boolean }>("/api/ads/estimate", msg.batchId ? null : { brandId: brand.id, engine, items: p.items, direction: p.direction, route: higgsfield && engine === "cloud" ? "higgsfield" : "fuobe" });
  const names = p.items.map((i) => products.find((x) => x.id === i.productId)?.name).filter(Boolean);
  return (
    <div className="mt-2 rounded-xl border bg-background p-3">
      <p className="text-[13px] font-medium">
        {total} ad{total === 1 ? "" : "s"} for {names.join(", ") || brand.name}
      </p>
      {p.direction && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{p.direction}</p>}
      {msg.batchId ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-success">
          <Check className="size-3.5" /> On their way to the grid
        </p>
      ) : (
        <button
          type="button"
          onClick={() =>
            confirm.mutate(
              { messageId: msg.id, engine, route: higgsfield && engine === "cloud" ? "higgsfield" : "fuobe" },
              { onSuccess: (r) => (toast.success(`Generating ${total} ads`, { duration: 1500 }), onConfirmed(r.batchId)), onError: (e) => toast.error((e as Error).message) },
            )
          }
          disabled={confirm.isPending}
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          {confirm.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Create {total} ads{est.data ? ` · ${est.data.demo ? "demo" : est.data.costUsd == null ? "" : `≈ ${formatCost(est.data.costUsd)}`}` : ""}
        </button>
      )}
    </div>
  );
}

/** The brand chat: ask for ads in plain words, @mention products, confirm what it proposes. */
export function AdChat({ brand, products, engine, onBatch, className }: { brand: BrandKit; products: Product[]; engine: "cloud" | "open"; onBatch: (batchId: string) => void; className?: string }) {
  const { query, say, clear } = useBrandChat(brand.id);
  const [name, setName] = useFirstName();
  const [text, setText] = useState("");
  const [ph, setPh] = useState(0);
  const [mention, setMention] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const messages = query.data ?? [];
  useEffect(() => {
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, say.isPending]);
  const sendText = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setText("");
    say.mutate(v, { onError: (e) => toast.error((e as Error).message) });
  };
  const insert = (p: Product) => {
    setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${p.name} `);
    setMention(false);
    requestAnimationFrame(() => box.current?.focus());
  };
  return (
    <aside className={cn("flex min-h-0 flex-col rounded-2xl border bg-background", className)} aria-label="Brand chat">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-[14px] font-semibold">Chat</p>
        {messages.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => clear.mutate()} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Clear chat">
                <Trash2 className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Clear chat</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div>
            <p className="font-heading text-[22px] leading-tight">
              {name ? `${name}, what` : "What"} ads should we make for {brand.name}?
            </p>
            {!name && (
              <input
                placeholder="Your first name (optional)"
                aria-label="Your first name"
                onKeyDown={(e) => e.key === "Enter" && setName((e.target as HTMLInputElement).value)}
                onBlur={(e) => e.target.value && setName(e.target.value)}
                className="mt-2 h-8 w-full rounded-lg border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
              />
            )}
            <div className="mt-3 flex flex-col gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} type="button" onClick={() => sendText(c)} className="rounded-xl bg-secondary px-3 py-2 text-left text-[13px] hover:bg-accent">
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed", m.role === "user" ? "bg-brand-faint text-foreground" : "bg-muted")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.role === "assistant" && m.proposal && <Proposal msg={m} brand={brand} products={products} engine={engine} onConfirmed={onBatch} />}
            </div>
          </div>
        ))}
        {say.isPending && (
          <div className="flex justify-start">
            <span className="rounded-2xl bg-muted px-3 py-2 text-[13px]">
              <span className="shimmer-text animate-shimmer-text">Thinking…</span>
            </span>
          </div>
        )}
      </div>
      <div className="border-t p-2.5">
        <div className="rounded-2xl border bg-background p-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint">
          <textarea
            ref={box}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.endsWith("@")) setMention(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendText(text);
              }
            }}
            rows={2}
            placeholder={PLACEHOLDERS[ph]}
            aria-label="Message"
            className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-subtle-foreground"
          />
          <div className="flex items-center justify-between">
            <Popover open={mention} onOpenChange={setMention}>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:bg-accent" aria-label="Mention a product">
                  <AtSign className="size-3.5" /> Mention a product
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-64 p-1" collisionPadding={12}>
                {products.length ? (
                  products.map((p) => (
                    <button key={p.id} type="button" onClick={() => insert(p)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent">
                      <span className="size-6 shrink-0 overflow-hidden rounded bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.images[0] && <img src={p.images[0]} alt="" className="size-full object-cover" />}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="p-2 text-[12px] text-muted-foreground">No products yet.</p>
                )}
              </PopoverContent>
            </Popover>
            <button type="button" onClick={() => sendText(text)} disabled={!text.trim() || say.isPending} className={cn("grid size-8 place-items-center rounded-full", text.trim() ? "bg-primary text-primary-foreground" : "bg-muted text-subtle-foreground")} aria-label="Send">
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
