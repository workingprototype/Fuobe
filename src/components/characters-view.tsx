"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ScanFace, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StudioPage } from "@/components/studio/studio-page";
import { fileToSlot, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import type { StudioConfig } from "@/components/studio/studio-context";

interface Character {
  id: string;
  name: string;
  description: string | null;
  references: string[];
  createdAt: number;
}

function useCharacters() {
  return useQuery({
    queryKey: ["characters"],
    queryFn: async () => ((await (await fetch("/api/characters")).json()) as { items: Character[] }).items,
  });
}

function CreateDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<SlotValue[]>([]);
  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, references: photos.filter((p) => p.ref).map((p) => p.ref) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body as Character;
    },
    onSuccess: () => {
      toast.success(`${name} is ready`);
      void qc.invalidateQueries({ queryKey: ["characters"] });
      setOpen(false);
      setName("");
      setPhotos([]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const uploading = photos.some((p) => p.uploading);
  const addFiles = (files: FileList | File[]) => {
    for (const f of [...files].slice(0, 20 - photos.length)) {
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New character
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New character</DialogTitle>
          <DialogDescription>Upload 3–20 clear photos of one person from different angles. Fuobe uses them as identity references on every generation.</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Maya" />
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
              <button onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))} className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-foreground/80 text-background" aria-label="Remove">
                <X className="size-3" />
              </button>
            </div>
          ))}
          {photos.length < 20 && <MediaSlot label="Add photos" kind="image" value={null} onChange={(v) => v && setPhotos((ps) => [...ps, { ...v, id: nanoid(6) }])} onFile={(f) => addFiles([f])} size="lg" />}
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || !photos.length || uploading || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="animate-spin" />} Create character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CharactersView() {
  const qc = useQueryClient();
  const chars = useCharacters();
  return (
    <PageShell>
      <PageHeader
        title="Characters"
        description="Keep the same person across every image and video. Cloud runs use multi-reference models (Nano Banana Pro, Seedream); open-source runs use Qwen-Image-Edit or FLUX.2 with the same references."
      >
        <CreateDialog />
      </PageHeader>
      {chars.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : chars.data?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {chars.data.map((c) => (
            <div key={c.id} className="group relative overflow-hidden rounded-xl border bg-background">
              <Link href={`/characters/${c.id}`} className="block">
                <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 bg-muted">
                  {c.references.slice(0, 4).map((r) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={r} src={r} alt="" className={c.references.length === 1 ? "col-span-2 row-span-2 size-full object-cover" : "size-full object-cover"} />
                  ))}
                </div>
                <div className="p-3">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-[12px] text-muted-foreground">{c.references.length} reference photos</p>
                </div>
              </Link>
              <button
                onClick={async () => {
                  await fetch(`/api/characters/${c.id}`, { method: "DELETE" });
                  void qc.invalidateQueries({ queryKey: ["characters"] });
                  toast("Deleted");
                }}
                className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-destructive"
                aria-label="Delete character"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-primary/10 bg-brand-faint px-6 py-14 text-center">
          <ScanFace className="mx-auto size-8 text-brand-text" />
          <p className="mt-3 font-heading text-[22px]">No characters yet</p>
          <p className="mt-1 text-[14px] text-muted-foreground">Create one from a few photos, then put them in any scene.</p>
        </div>
      )}
    </PageShell>
  );
}

export function CharacterStudio({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["character", id],
    queryFn: async () => {
      const r = await fetch(`/api/characters/${id}`);
      if (!r.ok) throw new Error("Character not found");
      return (await r.json()) as Character;
    },
  });
  const config = useMemo<StudioConfig | null>(() => {
    const c = q.data;
    if (!c) return null;
    return {
      feature: `character:${c.id}`,
      title: c.name,
      hero: `Where should ${c.name} go next?`,
      placeholder: `Describe a scene with ${c.name}… e.g. “walking through a Tokyo night market, candid street photo”`,
      kind: "image",
      ops: ["edit"],
      feed: { features: [`character:${c.id}`] },
      slots: [],
      multiRef: { label: "Add ref", max: 14 },
      defaultModels: { cloud: "nano-banana-pro", open: "oss-qwen-edit" },
      promptSuffix: `The person is the same individual shown in the reference images: keep their exact face, identity, skin tone and hair.`,
    };
  }, [q.data]);
  if (q.isError) return <PageShell><p className="text-muted-foreground">Character not found.</p></PageShell>;
  if (!config || !q.data) return <PageShell><Loader2 className="size-5 animate-spin text-muted-foreground" /></PageShell>;
  const refs = q.data.references.map((r) => `ref=${encodeURIComponent(r)}`).join("&");
  return <StudioPage config={config} key={refs} initialRefs={q.data.references} />;
}
