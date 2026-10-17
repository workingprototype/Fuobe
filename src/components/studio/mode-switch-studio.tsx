import {
  AUDIO_STUDIO,
  DIALOGUE_STUDIO,
  FOLEY_STUDIO,
  JOIN_CLIPS_STUDIO,
  MUSIC_STUDIO,
  SFX_STUDIO,
  TRANSLATE_STUDIO,
  UPSCALE_STUDIO,
  VIDEO_COLOR_MATCH_STUDIO,
  VIDEO_DEPTH_STUDIO,
  VIDEO_MATTE_STUDIO,
  VIDEO_RELIGHT_STUDIO,
  VIDEO_UPSCALE_STUDIO,
  VOICE_CHANGE_STUDIO,
} from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";
import { ModeStudio, type Mode } from "./mode-studio";

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
  "video-tools": [
    { id: "matte", label: "Remove background", config: VIDEO_MATTE_STUDIO },
    { id: "relight", label: "Relight", config: VIDEO_RELIGHT_STUDIO },
    { id: "depth", label: "Depth map", config: VIDEO_DEPTH_STUDIO },
    { id: "join", label: "Join clips", config: JOIN_CLIPS_STUDIO },
    { id: "colors", label: "Match colors", config: VIDEO_COLOR_MATCH_STUDIO },
  ],
} as const;

/**
 * A hub of studios switched by `?mode=` (Audio, Video tools, Upscale). Server component: each
 * mode's models are picked here, so the page ships only those.
 */
export function ModeSwitchStudio({ kind }: { kind: keyof typeof MODES }) {
  const modes: Mode[] = MODES[kind].map((m) => ({ id: m.id, label: m.label, config: m.config, catalog: studioCatalog(m.config) }));
  return <ModeStudio modes={modes} />;
}
