"use client";

import { Check, Loader2, Plus, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fileToList, type SlotValue } from "@/components/studio/media-slot";
import { useElements, useSaveElement } from "@/lib/api";
import type { StudioElement } from "@/lib/catalog/elements";
import { cn } from "@/lib/utils";

/** What a character brings: a trained Soul ID, a trained LoRA, or just photos. */
export function identityLabel(el: StudioElement): string {
  if (el.loras.some((l) => l.referenceId)) return "Soul ID";
  if (el.loras.length) return "LoRA";
  return `${el.references.length} photo${el.references.length === 1 ? "" : "s"}`;
}

/** Create a character from a few photos, without leaving the page. */
export function QuickCharacter({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (el: StudioElement) => void }) {
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<SlotValue[]>([]);
  const save = useSaveElement();
  const busy = photos.some((p) => p.uploading);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New character</DialogTitle>
          <DialogDescription>A few clear photos of one person: different angles, at least one full-body, no sunglasses, filters or group shots.</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. “Maya”" maxLength={60} aria-label="Character name" />
        <div className="grid grid-cols-4 gap-1.5">
          {photos.map((p, i) => (
            <div key={p.id ?? i} className="relative aspect-square overflow-hidden rounded-md bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="size-full object-cover" />
              {p.uploading && (
                <span className="absolute inset-0 grid place-items-center bg-background/60">
                  <Loader2 className="size-4 animate-spin" />
                </span>
              )}
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((xs) => xs.filter((x) => x !== p))} className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background">
                <X className="size-3" />
              </button>
            </div>
          ))}
          {photos.length < 20 && (
            <label className="grid aspect-square cursor-pointer place-items-center rounded-md border border-dashed text-muted-foreground hover:bg-accent">
              <Plus className="size-4" />
              <span className="sr-only">Add photos</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => ([...(e.target.files ?? [])].slice(0, 20 - photos.length).forEach((f) => fileToList(f, setPhotos, "image")), (e.target.value = ""))} />
            </label>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Or <Link href="/character-sheet" className="text-brand-text hover:underline">build one with Character Sheet</Link>, then pick it here.
        </p>
        <DialogFooter>
          <Button
            disabled={!name.trim() || !photos.length || busy || save.isPending}
            onClick={() =>
              save.mutate(
                { name: name.trim(), kind: "character", references: photos.map((p) => p.ref).filter(Boolean) },
                {
                  onSuccess: (el) => {
                    toast.success(`Saved as @${el.handle}`);
                    onCreated(el);
                    setName("");
                    setPhotos([]);
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            {(busy || save.isPending) && <Loader2 className="animate-spin" />} Save character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Your characters as cards (photo, name, what identity they carry), plus "New character". */
export function CharacterPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const { data, isLoading } = useElements();
  const [creating, setCreating] = useState(false);
  const characters = (data ?? []).filter((e) => e.kind === "character");
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-5" /> New character
        </button>
        {isLoading
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)
          : characters.map((el) => {
              const sel = value === el.id;
              return (
                <button
                  key={el.id}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => onChange(el.id)}
                  className={cn("group relative min-w-0 overflow-hidden rounded-xl bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", sel && "ring-3 ring-primary")}
                >
                  <span className="block aspect-[3/4]">
                    {el.references[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={el.references[0]} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-muted-foreground">
                        <UserRound className="size-6" />
                      </span>
                    )}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-white">
                    <span className="block truncate text-[12.5px] font-medium">{el.name}</span>
                    <span className="text-[11px] opacity-85">{identityLabel(el)}</span>
                  </span>
                  {sel && (
                    <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
      </div>
      <QuickCharacter open={creating} onOpenChange={setCreating} onCreated={(el) => onChange(el.id)} />
    </>
  );
}
