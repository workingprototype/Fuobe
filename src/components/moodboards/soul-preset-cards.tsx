"use client";

import { Images, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useStudio } from "@/components/studio/studio-context";

/**
 * The empty Image studio on Soul 2.0: Higgsfield's two "Make Soul 2.0 Preset" cards — a character of
 * your own (Character Sheet, then a Soul ID from its page) and a moodboard of your own. Kept free of
 * the moodboard logic (and the preset list it imports): every studio page loads it.
 */
export function SoulPresetCards() {
  const { draft } = useStudio();
  if (draft.modelId !== "soul-2") return null;
  const card =
    "group flex min-w-0 items-center gap-3 rounded-2xl border bg-background p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <section aria-label="Make Soul 2.0 Preset" className="mx-auto w-full max-w-[760px] px-3 pb-10">
      <p className="mb-2 text-center text-[12.5px] font-medium text-muted-foreground">Make Soul 2.0 Preset</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/character-sheet" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
            <UserRoundPlus className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">Make your own character</span>
            <span className="block truncate text-[12px] text-muted-foreground">A consistent face for every shot — train a Soul ID from it</span>
          </span>
        </Link>
        <Link href="/moodboards?create=1" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
            <Images className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">Create your moodboard</span>
            <span className="block truncate text-[12px] text-muted-foreground">20+ photos, one cohesive style, no faces.</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
