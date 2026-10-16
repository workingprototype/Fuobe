"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  AUDIO_STUDIO,
  DIALOGUE_STUDIO,
  FOLEY_STUDIO,
  MUSIC_STUDIO,
  SFX_STUDIO,
  TRANSLATE_STUDIO,
  UPSCALE_STUDIO,
  VIDEO_UPSCALE_STUDIO,
  VOICE_CHANGE_STUDIO,
} from "@/lib/studios";
import { cn } from "@/lib/utils";
import { StudioPage } from "./studio-page";

const MODES = {
  upscale: [
    { id: "image", label: "Image", config: UPSCALE_STUDIO },
    { id: "video", label: "Video", config: VIDEO_UPSCALE_STUDIO },
  ],
  audio: [
    { id: "speech", label: "Speech", config: AUDIO_STUDIO },
    { id: "dialogue", label: "Dialogue", config: DIALOGUE_STUDIO },
    { id: "voice-change", label: "Voice change", config: VOICE_CHANGE_STUDIO },
    { id: "translate", label: "Translate", config: TRANSLATE_STUDIO },
    { id: "sfx", label: "Sound effects", config: SFX_STUDIO },
    { id: "music", label: "Music", config: MUSIC_STUDIO },
    { id: "video", label: "Sound for video", config: FOLEY_STUDIO },
  ],
} as const;

function Inner({ kind }: { kind: keyof typeof MODES }) {
  const sp = useSearchParams();
  const router = useRouter();
  const modes = MODES[kind];
  const current = modes.find((m) => m.id === sp.get("mode")) ?? (sp.get("video") ? modes.find((m) => m.id === "video") : undefined) ?? modes[0];
  const tabs = (
    <div className="scrollbar-none inline-flex h-9 max-w-[52vw] items-center overflow-x-auto rounded-full bg-muted p-0.5 lg:max-w-none">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => router.replace(`?mode=${m.id}`)}
          className={cn(
            "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition",
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
