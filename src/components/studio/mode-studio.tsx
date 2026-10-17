"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import type { StudioCatalog } from "@/lib/studio-catalog";
import { cn } from "@/lib/utils";
import { StudioPage } from "./studio-page";
import type { StudioConfig } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";

export interface Mode {
  id: string;
  label: string;
  config: StudioConfig;
  catalog: StudioCatalog;
}

/** Underline tabs on their own row under the page title; they scroll sideways (with faded edges) on phones. */
function ModeTabs({ modes, current }: { modes: Mode[]; current: string }) {
  const [ref, fade] = useEdgeFade<HTMLDivElement>();
  const active = useRef<HTMLAnchorElement>(null);
  // Keep the selected tab in view when the row scrolls.
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return (
    <nav aria-label="Modes" className="border-b">
      <div ref={ref} style={fade} className="scrollbar-none flex gap-1 overflow-x-auto px-3 sm:px-6">
        {modes.map((m) => {
          const on = m.id === current;
          return (
            <Link
              key={m.id}
              ref={on ? active : undefined}
              href={`?mode=${m.id}`}
              replace
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex h-10 shrink-0 items-center px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors focus-visible:after:bg-ring",
                on && "text-foreground after:bg-foreground",
              )}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Pick({ modes, current }: { modes: Mode[]; current: Mode }) {
  return <StudioPage key={current.id} config={current.config} catalog={current.catalog} tabs={<ModeTabs modes={modes} current={current.id} />} />;
}

function FromUrl({ modes }: { modes: Mode[] }) {
  const sp = useSearchParams();
  const current = modes.find((m) => m.id === sp.get("mode")) ?? (sp.get("video") ? modes.find((m) => m.id === "video") : undefined) ?? modes[0];
  return <Pick modes={modes} current={current} />;
}

/** Studios switched by `?mode=`; the prerendered shell shows the first mode. */
export function ModeStudio({ modes }: { modes: Mode[] }) {
  return (
    <Suspense fallback={<Pick modes={modes} current={modes[0]} />}>
      <FromUrl modes={modes} />
    </Suspense>
  );
}
