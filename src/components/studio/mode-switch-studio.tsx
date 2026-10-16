"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AUDIO_STUDIO, FOLEY_STUDIO, UPSCALE_STUDIO, VIDEO_UPSCALE_STUDIO } from "@/lib/studios";
import { cn } from "@/lib/utils";
import { StudioPage } from "./studio-page";

const MODES = {
  upscale: [
    { id: "image", label: "Image", config: UPSCALE_STUDIO },
    { id: "video", label: "Video", config: VIDEO_UPSCALE_STUDIO },
  ],
  audio: [
    { id: "audio", label: "Voice, SFX & music", config: AUDIO_STUDIO },
    { id: "video", label: "Sound for video", config: FOLEY_STUDIO },
  ],
} as const;

function Inner({ kind }: { kind: keyof typeof MODES }) {
  const sp = useSearchParams();
  const router = useRouter();
  const modes = MODES[kind];
  const current = modes.find((m) => m.id === sp.get("mode")) ?? (sp.get("video") ? modes.find((m) => m.id === "video") : undefined) ?? modes[0];
  const tabs = (
    <div className="hidden h-9 items-center rounded-full bg-muted p-0.5 sm:inline-flex">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => router.replace(`?mode=${m.id}`)}
          className={cn(
            "h-8 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition",
            current.id === m.id && "bg-background text-foreground shadow-soft",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
  return <StudioPage key={current.id} config={current.config} header={tabs} />;
}

export function ModeSwitchStudio({ kind }: { kind: keyof typeof MODES }) {
  return (
    <Suspense fallback={null}>
      <Inner kind={kind} />
    </Suspense>
  );
}
