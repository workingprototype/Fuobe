"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Suspense, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/preset-gallery";
import { Feed } from "@/components/studio/feed";
import { Skeleton } from "@/components/ui/skeleton";
import { useGenerations, type FeedFilter } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS: { id: string; label: string; filter: FeedFilter }[] = [
  { id: "all", label: "All", filter: {} },
  { id: "images", label: "Images", filter: { kind: "image" } },
  { id: "videos", label: "Videos", filter: { kind: "video" } },
  { id: "audio", label: "Audio", filter: { kind: "audio" } },
  { id: "favorites", label: "Favorites", filter: { favorites: true } },
];

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.find((t) => t.id === sp.get("tab")) ?? TABS[0];
  const [q, setQ] = useState("");
  const feed = useGenerations({ ...tab.filter, q: q || undefined, limit: 120 });
  return (
    <PageShell>
      <PageHeader title="Library" description="Everything you make lands here — across cloud and open-source runs.">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search prompts"
            className="h-8 w-56 rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-primary"
          />
        </div>
      </PageHeader>
      <div className="mb-6 flex gap-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => router.replace(`/library?tab=${t.id}`)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-1 pb-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground",
              tab.id === t.id && "border-foreground font-medium text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {feed.isLoading ? (
        <div className="flex gap-2">
          <Skeleton className="h-56 w-56 rounded-xl" />
          <Skeleton className="h-56 w-80 rounded-xl" />
        </div>
      ) : (
        <Feed
          items={feed.data ?? []}
          empty={
            <div className="rounded-xl border border-primary/10 bg-brand-faint px-6 py-12 text-center">
              <p className="font-heading text-[22px]">{q ? `No matches for “${q}”` : "Nothing here yet"}</p>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {q ? "Try another word." : "Generate something and it will show up here."}{" "}
                {!q && (
                  <Link href="/image" className="text-brand-text hover:underline">
                    Create an image
                  </Link>
                )}
              </p>
            </div>
          }
        />
      )}
    </PageShell>
  );
}

export function LibraryView() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
