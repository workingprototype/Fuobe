"use client";

import Link from "next/link";
import { ArrowRight, AudioLines, Film, ImageIcon, Mic2, ScanFace, Sparkles, Video, Wand2, ZoomIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { PresetCard } from "@/components/preset-gallery";
import { Feed } from "@/components/studio/feed";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import { useEngine, useGenerations, useStatus } from "@/lib/api";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "image", label: "Image", icon: ImageIcon, href: "/image", placeholder: "Describe an image…" },
  { id: "video", label: "Video", icon: Video, href: "/video", placeholder: "Describe a shot…" },
  { id: "edit", label: "Edit", icon: Wand2, href: "/edit", placeholder: "Describe a change (you'll add the image next)…" },
];

const TOOLS = [
  { href: "/motions", label: "Camera motions", desc: `${MOTIONS.length} director moves`, icon: Film, hue: 280 },
  { href: "/effects", label: "Effects", desc: `${EFFECTS.length} viral VFX`, icon: Sparkles, hue: 20 },
  { href: "/apps", label: "Apps", desc: `${APPS.length} one-click tools`, icon: Wand2, hue: 200 },
  { href: "/lipsync", label: "Lipsync", desc: "Talking avatars", icon: Mic2, hue: 150 },
  { href: "/characters", label: "Characters", desc: "Consistent people", icon: ScanFace, hue: 320 },
  { href: "/upscale", label: "Upscale", desc: "Images & video", icon: ZoomIn, hue: 240 },
  { href: "/audio", label: "Audio", desc: "Voice, SFX, music", icon: AudioLines, hue: 60 },
];

function Row({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[24px]">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

export function HomeView() {
  const router = useRouter();
  const [mode, setMode] = useState(MODES[0]);
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useEngine();
  const recent = useGenerations({ limit: 6 });
  const status = useStatus().data;
  const nothingConnected = status && !status.providers.fal?.configured && !status.providers.replicate?.configured && !status.providers.comfyui?.configured;

  const go = () => router.push(`${mode.href}${prompt.trim() ? `?prompt=${encodeURIComponent(prompt.trim())}` : ""}`);

  return (
    <PageShell>
      <div className="flex flex-col items-center pt-[8vh] text-center">
        <h1 className="font-heading text-display text-balance sm:text-[44px]">What will you create today?</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Frontier cloud models or fully open-source workflows — same studio, your choice.</p>
        <div className="mt-8 w-full max-w-[720px] rounded-[20px] border bg-background p-2.5 text-left shadow-soft transition focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
            rows={2}
            autoFocus
            placeholder={mode.placeholder}
            className="field-sizing-content max-h-48 min-h-14 w-full resize-none bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-subtle-foreground"
          />
          <div className="flex items-center gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                  mode.id === m.id ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                )}
              >
                <m.icon className="size-3.5" /> {m.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:block">
                <EngineSwitch value={engine} onChange={setEngine} size="sm" />
              </span>
              <button onClick={go} className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90" aria-label="Start">
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {nothingConnected && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            You’re in <span className="font-medium text-foreground">demo mode</span> — outputs are placeholders.{" "}
            <Link href="/settings" className="text-brand-text underline-offset-2 hover:underline">
              Add a fal.ai key or connect ComfyUI
            </Link>{" "}
            to generate for real.
          </p>
        )}
      </div>

      <div className="mt-14 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="group flex flex-col gap-2 rounded-xl border bg-background p-3 transition-colors hover:bg-accent">
            <span className="grid size-9 place-items-center rounded-lg text-white" style={{ background: `linear-gradient(135deg, oklch(0.75 0.15 ${t.hue}), oklch(0.55 0.2 ${t.hue + 40}))` }}>
              <t.icon className="size-4 transition-transform group-hover:scale-110" />
            </span>
            <span>
              <span className="block text-[13px] font-medium">{t.label}</span>
              <span className="block text-[12px] text-muted-foreground">{t.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-14 space-y-12">
        {!!recent.data?.length && (
          <Row title="Recent" href="/library">
            <Feed items={recent.data.slice(0, 3)} />
          </Row>
        )}
        <Row title="Camera motions" href="/motions">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {MOTIONS.filter((m) => ["motion-crash-zoom-in", "motion-360-orbit", "motion-bullet-time", "motion-fpv-drone", "motion-dolly-zoom-in", "motion-snorricam"].includes(m.id)).map((p) => (
              <PresetCard key={p.id} preset={p} href={`/video?preset=${p.id}`} compact />
            ))}
          </div>
        </Row>
        <Row title="Popular apps" href="/apps">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {APPS.slice(0, 12).filter((a) => a.badges?.includes("top") || a.category === "Camera").slice(0, 6).map((p) => (
              <PresetCard key={p.id} preset={p} href={`/apps/${p.id}`} compact />
            ))}
          </div>
        </Row>
        <Row title="Effects" href="/effects">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {EFFECTS.slice(0, 6).map((p) => (
              <PresetCard key={p.id} preset={p} href={`/video?preset=${p.id}`} compact />
            ))}
          </div>
        </Row>
      </div>
    </PageShell>
  );
}
