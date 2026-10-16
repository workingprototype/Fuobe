"use client";

import { AtSign, Check, Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StudioPage } from "@/components/studio/studio-page";
import { fileToSlot, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { ELEMENT_ICONS } from "@/components/studio/prompt-input";
import type { StudioConfig } from "@/components/studio/studio-context";
import { useDeleteElement, useElement, useElements, useSaveElement } from "@/lib/api";
import { ELEMENT_KINDS, elementKindInfo, handleFor, type ElementKind, type StudioElement } from "@/lib/catalog/elements";
import { cn } from "@/lib/utils";

const TIPS: Record<ElementKind, string> = {
  character: "3–20 clear photos of one person: different angles, at least one full-body, no sunglasses, filters or group shots.",
  location: "1–6 photos of the place from a few viewpoints.",
  prop: "1–4 clean photos of the object, ideally on a plain background.",
  style: "2–10 images that share the look you want: palette, lighting, grain, mood.",
};

const MAX_PHOTOS = 20;

function PhotoGrid({ photos, setPhotos }: { photos: SlotValue[]; setPhotos: React.Dispatch<React.SetStateAction<SlotValue[]>> }) {
  const addFiles = (files: FileList | File[]) => {
    for (const f of [...files].slice(0, MAX_PHOTOS - photos.length)) {
      const id = nanoid(6);
      void fileToSlot(f, (v) =>
        setPhotos((ps) => {
          if (!v) return ps.filter((p) => p.id !== id);
          return ps.some((p) => p.id === id) ? ps.map((p) => (p.id === id ? { ...v, id } : p)) : [...ps, { ...v, id }];
        }),
      );
    }
  };
  return (
    <div
      className="flex flex-wrap gap-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {photos.map((p) => (
        <div key={p.id} className="relative size-20 overflow-hidden rounded-xl border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.preview} alt="" className="size-full object-cover" />
          {p.uploading && (
            <div className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}
          <button
            onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
            aria-label="Remove photo"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {photos.length < MAX_PHOTOS && (
        <MediaSlot
          label="Add photos"
          kind="image"
          value={null}
          onChange={(v) => v && setPhotos((ps) => [...ps, { ...v, id: nanoid(6) }])}
          onFile={(f) => addFiles([f])}
          size="lg"
        />
      )}
    </div>
  );
}

interface ElementDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  element?: StudioElement;
  defaultKind?: ElementKind;
  onSaved?: (el: StudioElement) => void;
}

/** Create or edit an element. */
export function ElementDialog(props: ElementDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">{props.open && <ElementForm {...props} />}</DialogContent>
    </Dialog>
  );
}

function ElementForm({ onOpenChange, element, defaultKind = "character", onSaved }: ElementDialogProps) {
  const save = useSaveElement();
  const [kind, setKind] = useState<ElementKind>(element?.kind ?? defaultKind);
  const [name, setName] = useState(element?.name ?? "");
  const [description, setDescription] = useState(element?.description ?? "");
  const [photos, setPhotos] = useState<SlotValue[]>(() => (element?.references ?? []).map((r) => ({ id: nanoid(6), ref: r, preview: r, kind: "image" })));

  const uploading = photos.some((p) => p.uploading);
  const refs = photos.filter((p) => p.ref).map((p) => p.ref);
  const canSave = !!name.trim() && (refs.length > 0 || !!description.trim()) && !uploading && !save.isPending;

  const submit = () =>
    save.mutate(
      { id: element?.id, name, kind, description: description || null, references: refs },
      {
        onSuccess: (el) => {
          toast.success(element ? "Saved" : `@${el.handle} is ready — type @ in any prompt`);
          onOpenChange(false);
          onSaved?.(el);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{element ? `Edit ${element.name}` : "New element"}</DialogTitle>
        <DialogDescription>Save it once, then type @ in any image or video prompt to put it in the shot.</DialogDescription>
      </DialogHeader>
      {!element && (
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {ELEMENT_KINDS.map((k) => {
            const Icon = ELEMENT_ICONS[k.kind];
            return (
              <button
                key={k.kind}
                onClick={() => setKind(k.kind)}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-[12px] font-medium text-muted-foreground transition",
                  kind === k.kind && "bg-background text-foreground shadow-soft",
                )}
              >
                <Icon className="size-4" />
                {k.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="space-y-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            kind === "character"
              ? "Name, e.g. Maya"
              : kind === "location"
                ? "Name, e.g. Rooftop bar"
                : kind === "prop"
                  ? "Name, e.g. Red sneaker"
                  : "Name, e.g. Film noir"
          }
          autoFocus
        />
        <p className="flex items-center gap-1 px-1 text-[12px] text-muted-foreground">
          <AtSign className="size-3" />
          {name.trim() ? handleFor(name) : "handle"} <span className="text-subtle-foreground">— how you mention it in prompts</span>
        </p>
      </div>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Short description (optional) — used when a model can't take photos, e.g. “woman in her 30s, short copper hair, freckles”"
        className="resize-none text-sm"
      />
      <div className="space-y-2">
        <p className="text-[12px] text-muted-foreground">{TIPS[kind]}</p>
        <PhotoGrid photos={photos} setPhotos={setPhotos} />
      </div>
      <DialogFooter>
        <Button disabled={!canSave} onClick={submit}>
          {save.isPending && <Loader2 className="animate-spin" />} {element ? "Save" : `Create ${elementKindInfo(kind).label.toLowerCase()}`}
        </Button>
      </DialogFooter>
    </>
  );
}

function HandleCopy({ handle }: { handle: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        void navigator.clipboard?.writeText(`@${handle}`);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded-md px-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="Copy handle"
    >
      @{handle} {done ? <Check className="size-3" /> : <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

function ElementCard({ el }: { el: StudioElement }) {
  const del = useDeleteElement();
  const Icon = ELEMENT_ICONS[el.kind];
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-background transition-shadow hover:shadow-normal">
      <Link href={`/elements/${el.id}`} className="block">
        <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 bg-muted">
          {el.references.length ? (
            el.references.slice(0, 4).map((r, i, arr) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={r}
                src={r}
                alt=""
                className={cn(
                  "size-full object-cover",
                  arr.length === 1 && "col-span-2 row-span-2",
                  arr.length === 2 && "row-span-2",
                  arr.length === 3 && i === 0 && "row-span-2",
                )}
              />
            ))
          ) : (
            <div className="col-span-2 row-span-2 grid place-items-center text-muted-foreground">
              <Icon className="size-8" />
            </div>
          )}
        </div>
      </Link>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{el.name}</p>
          <HandleCopy handle={el.handle} />
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
          <Icon className="size-3" /> {elementKindInfo(el.kind).label}
        </span>
      </div>
      <button
        onClick={() => {
          del.mutate(el.id);
          toast(`Deleted ${el.name}`);
        }}
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-destructive"
        aria-label={`Delete ${el.name}`}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function ElementsBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const els = useElements();
  const [tab, setTab] = useState<ElementKind | "all">("all");
  const [open, setOpen] = useState(sp.get("new") === "1");
  const list = useMemo(() => (els.data ?? []).filter((e) => tab === "all" || e.kind === tab), [els.data, tab]);

  return (
    <PageShell>
      <PageHeader
        title="Elements"
        description="Characters, locations, props and styles you can reuse. Save one once, then type @ in any image or video prompt — Fuobe sends its photos as references, or its trained LoRA when you've trained one."
      >
        <Button onClick={() => setOpen(true)}>
          <Plus /> New element
        </Button>
      </PageHeader>
      <div className="mb-5 flex gap-1">
        {(["all", ...ELEMENT_KINDS.map((k) => k.kind)] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent",
              tab === k && "bg-secondary text-foreground",
            )}
          >
            {k === "all" ? "All" : elementKindInfo(k).plural}
          </button>
        ))}
      </div>
      {els.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : list.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((el) => (
            <ElementCard key={el.id} el={el} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-primary/10 bg-brand-faint px-6 py-14 text-center">
          <AtSign className="mx-auto size-8 text-brand-text" />
          <p className="mt-3 font-heading text-[22px]">{tab === "all" ? "No elements yet" : `No ${elementKindInfo(tab).plural.toLowerCase()} yet`}</p>
          <p className="mx-auto mt-1 max-w-md text-[14px] text-muted-foreground">
            Save a person, a place or a product from a few photos. Then write “@Maya walking into @Rooftop_bar” in any prompt.
          </p>
          <Button className="mt-5" variant="outline" onClick={() => setOpen(true)}>
            <Plus /> New element
          </Button>
        </div>
      )}
      <ElementDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && sp.get("new")) router.replace("/elements");
        }}
        defaultKind={tab === "all" ? "character" : tab}
      />
    </PageShell>
  );
}

export function ElementsView() {
  return (
    <Suspense fallback={null}>
      <ElementsBody />
    </Suspense>
  );
}

/** A studio for one element: the prompt starts with its @handle, references are resolved by the server. */
export function ElementStudio({ id }: { id: string }) {
  const q = useElement(id);
  const [editing, setEditing] = useState(false);
  const el = q.data;
  const config = useMemo<StudioConfig | null>(() => {
    if (!el) return null;
    return {
      feature: `element:${el.id}`,
      title: el.name,
      hero:
        el.kind === "character"
          ? `Where should ${el.name} go next?`
          : el.kind === "location"
            ? `What happens at ${el.name}?`
            : el.kind === "prop"
              ? `Where should ${el.name} show up?`
              : `What should look like ${el.name}?`,
      subtitle: `Mention @${el.handle} in any studio to use ${el.kind === "character" ? "them" : "it"} there too.`,
      placeholder: `Describe a scene with @${el.handle}…`,
      kind: "image",
      ops: ["t2i", "edit"],
      feed: { features: [`element:${el.id}`, `character:${el.id}`] },
      slots: [],
      multiRef: { label: "Add ref", max: 8 },
      defaultModels: { cloud: "nano-banana-pro", open: "oss-qwen-edit" },
    };
  }, [el]);
  if (q.isError)
    return (
      <PageShell>
        <p className="text-muted-foreground">Element not found.</p>
      </PageShell>
    );
  if (!config || !el)
    return (
      <PageShell>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </PageShell>
    );
  return (
    <>
      <StudioPage
        config={config}
        initialPrompt={`@${el.handle} `}
        header={
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        }
      />
      <ElementDialog open={editing} onOpenChange={setEditing} element={el} />
    </>
  );
}
