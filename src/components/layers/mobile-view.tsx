"use client";

import { ArrowLeft, EyeOff, MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import type { LayerDoc, LayerJob, LayerProject } from "@/lib/layers";
import { LayerThumb } from "./layers-panel";
import { renderDoc, toBlob } from "./render";
import { DownloadMenu } from "./top-bar";

/** Phones: a friendly read-only view with the picture, its layers and the downloads. */
export function MobileView({ project, doc, jobs }: { project: LayerProject; doc: LayerDoc; jobs: LayerJob[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let gone = false;
    void renderDoc(doc, { scale: Math.min(1, 1200 / Math.max(doc.width, doc.height)) })
      .then((c) => toBlob(c))
      .then((b) => {
        if (gone) return;
        url = URL.createObjectURL(b);
        setPreview(url);
      })
      .catch(() => setPreview(doc.source));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc]);
  const rows = [...doc.nodes].sort((a, b) => b.z - a.z);

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-1.5 bg-background/85 px-3 backdrop-blur">
        <SidebarTrigger />
        <Button asChild variant="ghost" size="icon-sm" aria-label="All projects">
          <Link href="/layers">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-heading text-[20px]">{project.name}</h1>
        <DownloadMenu doc={doc} name={project.name} jobs={jobs} compact />
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 pb-12">
        <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand-text">
            <MonitorSmartphone className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-medium">Layers works best on a larger screen</p>
            <p className="text-[13px] text-pretty text-muted-foreground">Open this project on a computer to separate, move and edit layers. Here you can preview it and download the layers.</p>
          </div>
        </div>
        <div className="checkerboard overflow-hidden rounded-xl border" style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt={`${project.name}, all visible layers`} className="size-full object-contain" /> : <Skeleton className="size-full rounded-none" />}
        </div>
        <section aria-labelledby="mobile-layers">
          <h2 id="mobile-layers" className="mb-2 text-[13px] font-semibold">
            Layers <span className="font-mono font-normal text-subtle-foreground">{rows.length}</span>
          </h2>
          <ul className="divide-y rounded-xl border">
            {rows.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-3 py-2">
                <LayerThumb node={n} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{n.name}</span>
                {n.hidden && <EyeOff className="size-4 text-muted-foreground" aria-label="Hidden" />}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
