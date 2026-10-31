import Link from "next/link";
import { ArrowRight, AudioLines, Box, CalendarClock, ImageIcon, ListChecks, Plug, ScanEye, Sparkles, Video, type LucideIcon } from "lucide-react";
import { GitHubMark } from "@/components/github-mark";
import { BeforeAfter } from "@/components/home/before-after";
import { CopyCommand, FadeRow, HomeRail, PausePreviews, StartSteps, StudioCard, StudioName, StudioPicture } from "@/components/home/home-islands";
import { ShowcaseTile } from "@/components/home/showcase-tile";
import { IntentLink } from "@/components/intent-link";
import { NAV } from "@/components/nav-items";
import { PresetCard } from "@/components/preset-gallery";
import { ASSIST_SUGGESTIONS } from "@/lib/assist";
import { FUOBE_REPO } from "@/lib/connections";
import { presetHref, type HomeShowcase } from "@/lib/home-showcase";
import type { PresetCardData } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";

/*
 * Home's sections under the wall. Server components: their words, numbers and links ship as HTML, and only the
 * cards, the before/after, the Copy button and the start steps hydrate (home-islands.tsx, before-after.tsx).
 */

/** A card in a HomeRail: two-thirds of a phone's width (the next one peeks in), a grid cell from sm up. */
const RAIL_ITEM = "w-[64%] shrink-0 snap-start sm:w-auto";
const SECTION = "mt-10 sm:mt-14";
const H2 = "font-heading text-[24px] leading-tight sm:text-[28px]";
const LINE = "mt-1 text-[15px] text-pretty text-muted-foreground";

const navIcon = (href: string) => NAV.flatMap((g) => g.items).find((i) => i.href === href)?.icon;

function SectionHead({ id, title, count, all, line }: { id: string; title: string; count?: number; all?: string; line: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id={id} className={H2}>
          {title}
          {count !== undefined && (
            <span className="ml-2 inline-block rounded-full bg-muted px-2 align-[0.3em] font-sans text-[13px] leading-6 tracking-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {all && (
          <IntentLink
            href={all}
            className="group inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            See all {count} <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </IntentLink>
        )}
      </div>
      <p className={LINE}>{line}</p>
    </div>
  );
}

/** Preset cards: all of them in a phone's rail; from sm up, the first `wide` (a rail costs no height, a grid does). */
function Cards({ cards, className, wide = cards.length }: { cards: PresetCardData[]; className: string; wide?: number }) {
  return (
    <HomeRail className={cn("gap-1", className)}>
      {cards.map((c, i) => (
        <div key={c.id} className={cn(RAIL_ITEM, i >= wide && "sm:hidden")}>
          <PresetCard preset={c} href={presetHref(c.id)} bare />
        </div>
      ))}
    </HomeRail>
  );
}

/** The first pictures on the page: eight real covers, four on a phone. */
export function ShowcaseWall({ wall }: { wall: HomeShowcase["wall"] }) {
  return (
    <section aria-label="What Fuobe makes" className="mt-6 sm:mt-8">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:max-lg:grid-cols-2">
        {wall.map((t, i) => (
          <ShowcaseTile key={t.id} card={t.card} kind={t.kind} caption={t.caption} href={t.href} index={i} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
        <p className="min-w-0">
          <span className="sm:hidden">Rendered locally on ComfyUI, on one RTX 5090.</span>
          <span className="max-sm:hidden">Every preview on this page was rendered locally on ComfyUI, on one RTX 5090.</span>
        </p>
        <PausePreviews />
      </div>
    </section>
  );
}

export function EffectsSection({ facts, effects }: Pick<HomeShowcase, "facts" | "effects">) {
  return (
    <section aria-labelledby="home-effects" className={SECTION}>
      <SectionHead
        id="home-effects"
        title="Effects"
        count={facts.effects}
        all="/effects"
        line="Add one photo and get the shot: fire, wings, floods, explosions."
      />
      <Cards cards={effects} className="sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" />
    </section>
  );
}

export function MotionsSection({ facts, motions }: Pick<HomeShowcase, "facts" | "motions">) {
  return (
    <section aria-labelledby="home-motions" className={SECTION}>
      <SectionHead
        id="home-motions"
        title="Camera motions"
        count={facts.motions}
        all="/motions"
        line="Moves a film crew would make: orbits, drone dives, crash zooms. Mix any two."
      />
      <Cards cards={motions} wide={6} className="sm:grid-cols-3 xl:grid-cols-6" />
    </section>
  );
}

export function AppsSection({ facts, beforeAfter, reveals }: Pick<HomeShowcase, "facts" | "beforeAfter" | "reveals">) {
  return (
    <section aria-labelledby="home-apps" className={SECTION}>
      <SectionHead id="home-apps" title="Apps" count={facts.apps} all="/apps" line="One click changes one thing and keeps the rest." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:gap-4">
        <div className="min-w-0 xl:col-span-5 xl:pt-1.5">
          <BeforeAfter pairs={beforeAfter} />
        </div>
        <Cards cards={reveals} className="self-start sm:grid-cols-3 xl:col-span-7" />
      </div>
    </section>
  );
}

/** Heights of the Audio card's bars (0–1): a waveform drawn once, not a recording. */
const WAVE = [
  0.3, 0.45, 0.7, 0.5, 0.85, 1, 0.75, 0.55, 0.4, 0.6, 0.9, 0.7, 0.45, 0.3, 0.5, 0.8, 0.95, 0.65, 0.4, 0.55, 0.75, 0.5, 0.35, 0.6, 0.8, 0.55, 0.35, 0.25,
];

/** Audio has no cover: its card shows a waveform that ripples on hover, and the studio's tools by name. */
function AudioCard({ href, label, line, tools }: { href: string; label: string; line: string; tools: HomeShowcase["audioTools"] }) {
  return (
    <IntentLink href={href} className="group/studio flex min-w-0 flex-col gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StudioPicture className="bg-media">
        <div className="absolute inset-0 flex flex-col justify-center gap-[9%] px-[9%]">
          <div aria-hidden className="flex h-[38%] items-center gap-[2.5%]">
            {WAVE.map((h, i) => (
              <i
                key={i}
                className="flex-1 rounded-full bg-white/85 motion-safe:group-hover/studio:animate-wave-bar motion-safe:group-focus-visible/studio:animate-wave-bar"
                style={{ height: `${h * 100}%`, animationDelay: `${-i * 70}ms` }}
              />
            ))}
          </div>
          <p className="text-[12px] leading-snug text-white/70">
            {tools.named.join(" · ")}
            {tools.more > 0 && ` · ${tools.more} more`}
          </p>
        </div>
      </StudioPicture>
      <StudioName label={label} line={line} />
    </IntentLink>
  );
}

export function StudiosSection({ facts, studios, audioTools, pills }: Pick<HomeShowcase, "facts" | "studios" | "audioTools" | "pills">) {
  return (
    <section aria-labelledby="home-studios" className={SECTION}>
      <SectionHead
        id="home-studios"
        title="Studios and tools"
        count={facts.destinations}
        line="Whole productions, start to finish: films, ads, shoots and series. Open any of them to look around, no account needed."
      />
      <HomeRail className="gap-3 sm:grid-cols-2 sm:gap-x-3 sm:gap-y-4 lg:grid-cols-4">
        {studios.map((s) => (
          <div key={s.href} className={RAIL_ITEM}>
            {s.card ? (
              <StudioCard href={s.href} label={s.label} line={s.line} card={s.card} zoom={!s.card.preview.video} />
            ) : (
              <AudioCard href={s.href} label={s.label} line={s.line} tools={audioTools} />
            )}
          </div>
        ))}
      </HomeRail>
      <h3 className="mt-6 mb-2 font-sans text-[13px] text-muted-foreground">Also in Fuobe</h3>
      {/* A phone scrolls the pills sideways in three rows. */}
      <FadeRow>
        <ul className="flex flex-wrap gap-1.5 max-sm:w-[72rem]">
          {pills.map((p) => {
            const Icon = navIcon(p.href);
            return (
              <li key={p.href}>
                <IntentLink
                  href={p.href}
                  className="group inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors hover:bg-accent"
                >
                  {Icon && <Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-brand-text" />}
                  {p.label}
                </IntentLink>
              </li>
            );
          })}
        </ul>
      </FadeRow>
    </section>
  );
}

export function AssistSection({ facts, runsOn, skills }: Pick<HomeShowcase, "facts" | "runsOn" | "skills">) {
  const points: [LucideIcon, string][] = [
    [ListChecks, "Plans every step and prices it first"],
    [ScanEye, "Checks each result before the next step"],
    [Sparkles, `${facts.skills} built-in skills, projects and memory`],
    [CalendarClock, "Scheduled tasks, with a cost cap"],
    [Plug, "MCP connectors, a CLI and its own MCP server"],
  ];
  return (
    <section aria-labelledby="home-assist" className={SECTION}>
      <div className="grid gap-8 rounded-2xl border bg-card p-5 sm:p-7 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 id="home-assist" className={H2}>
            Assist runs the whole job
          </h2>
          <p className={LINE}>
            Describe the job in one message. Assist picks the models, shows the plan and what it costs, and runs every step when you say go.
          </p>
          <ul className="mt-5 space-y-2.5">
            {points.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-2.5 text-[13px]">
                <Icon className="size-4 shrink-0 text-brand-text" />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[12px] text-pretty text-muted-foreground">
            Plans with the LLM you pick: {runsOn.named.join(", ")}
            {runsOn.more > 0 && `, and ${runsOn.more} more`}, a local LLM ({runsOn.local.join(", ")}), or an offline planner with no LLM at all.
          </p>
          <IntentLink
            href="/assist"
            className="group mt-5 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            Open Assist <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
          </IntentLink>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 font-sans text-[12px] text-muted-foreground">Try asking</h3>
          <ul className="space-y-1.5">
            {ASSIST_SUGGESTIONS.map((s) => (
              <li key={s}>
                <IntentLink
                  href={`/assist?prompt=${encodeURIComponent(s)}`}
                  className="group flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-2.5 text-[13px] transition-colors hover:bg-muted"
                >
                  <span className="min-w-0">{s}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-[3px] group-hover:text-foreground" />
                </IntentLink>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 mb-2 font-sans text-[12px] text-muted-foreground">Or start with a skill</h3>
          <FadeRow>
            <ul className="flex gap-1.5 max-sm:w-max sm:flex-wrap">
              {skills.map((s) => (
                <li key={s.name}>
                  <IntentLink
                    href={`/assist?skill=${s.name}`}
                    className="inline-flex h-8 items-center rounded-full border px-3 text-[13px] transition-colors hover:bg-accent"
                  >
                    {s.title}
                  </IntentLink>
                </li>
              ))}
            </ul>
          </FadeRow>
        </div>
      </div>
    </section>
  );
}

const KIND_ICON: Record<string, LucideIcon> = { image: ImageIcon, video: Video, audio: AudioLines, model3d: Box };

export function OpenSourceSection({ facts, newModels }: Pick<HomeShowcase, "facts" | "newModels">) {
  const numbers = [
    { value: facts.openModels, label: "open-source models, each licence listed", href: "/settings/about" },
    { value: facts.workflows, label: "ComfyUI workflows to read, run and change", href: "/workflows" },
    { value: facts.originals, label: "Fuobe Originals, free on your GPU", href: "/models?q=Fuobe" },
    { value: facts.presets, label: "presets: apps, camera motions and effects", href: "/effects" },
    { value: facts.partners, label: "partner models through your own fal.ai or Replicate key", href: "/models" },
  ];
  return (
    <section aria-labelledby="home-open" className={SECTION}>
      <h2 id="home-open" className={H2}>
        Open source, all the way down
      </h2>
      <p className={cn(LINE, "max-w-[62ch]")}>
        The code is MIT-licensed. Every open model comes with its ComfyUI workflow, its files and its licence, and runs on your own GPU.
      </p>
      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl bg-muted/50 p-6 sm:grid-cols-3 xl:grid-cols-5">
        {numbers.map((n, i) => (
          <li key={n.href} className={cn("min-w-0", i === numbers.length - 1 && "max-sm:col-span-2")}>
            <IntentLink href={n.href} className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="block font-heading text-[34px] leading-none tabular-nums transition-colors group-hover:text-brand-text">{n.value}</span>
              <span className="mt-1.5 block text-[12px] leading-snug text-muted-foreground">{n.label}</span>
            </IntentLink>
          </li>
        ))}
      </ul>
      {newModels.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-sans text-[13px] font-medium">Just added</h3>
          <FadeRow>
            <ul className="flex gap-1.5 max-sm:w-max sm:flex-wrap">
              {newModels.map((m) => {
                const Icon = KIND_ICON[m.kind] ?? Sparkles;
                return (
                  <li key={m.id}>
                    <IntentLink
                      href={m.href}
                      title={m.tagline}
                      className="group inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors hover:bg-accent"
                    >
                      <Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-brand-text" />
                      {m.name}
                      <span className="text-muted-foreground">· {m.vendor}</span>
                    </IntentLink>
                  </li>
                );
              })}
            </ul>
          </FadeRow>
        </>
      )}
    </section>
  );
}

/** The README's own three lines. */
const COMMANDS = ["git clone https://github.com/workingprototype/fuobe.git && cd fuobe", "pnpm install", "pnpm dev"].join("\n");

export function StartSection() {
  return (
    <section aria-labelledby="home-start" className={SECTION}>
      <h2 id="home-start" className={H2}>
        Your GPU. Your models. Your files.
      </h2>
      <p className={LINE}>No account to look around. A free account to run. Your own server if you want all of it.</p>
      <div className="mt-6 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <StartSteps />
        </div>
        <div className="min-w-0 rounded-2xl bg-media p-5 text-white ring-1 ring-white/10 lg:col-span-7">
          <p className="text-[15px] font-medium">Or run all of Fuobe yourself</p>
          <p className="mt-1 text-[13px] text-white/70">
            MIT licence. Keys, settings and results stay on your machine. Demo mode works with nothing connected.
          </p>
          <div className="mt-4 min-w-0 overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-white/10">
            <div className="flex items-center justify-between py-2 pr-2 pl-4">
              <span className="text-[12px] text-white/55">Terminal</span>
              <CopyCommand text={COMMANDS} />
            </div>
            <pre className="overflow-x-auto px-4 pb-4 font-mono text-[13px] leading-relaxed text-white/90">
              <code>{COMMANDS}</code>
            </pre>
          </div>
          <p className="mt-3 text-[12px] text-white/70">
            On Windows, <code className="font-mono text-white/90">start.bat</code> installs and starts everything.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={FUOBE_REPO}
              target="_blank"
              rel="noopener"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
            >
              <GitHubMark className="size-3.5" /> View on GitHub
            </a>
            <IntentLink
              href="/workflows"
              className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/10"
            >
              ComfyUI workflows
            </IntentLink>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomeFooter() {
  const engine = NAV.find((g) => g.label === "Engine")?.items.filter((i) => i.href !== "/settings") ?? [];
  const link = "transition-colors hover:text-foreground";
  return (
    <footer className="mt-12 flex flex-wrap items-end justify-between gap-4 border-t pt-8 pb-4">
      <div>
        <p className="font-heading text-[22px] leading-none">Fuobe</p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">Open source under the MIT licence.</p>
      </div>
      <nav aria-label="About Fuobe" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        {engine.map((i) => (
          <Link key={i.href} href={i.href} prefetch={false} className={link}>
            {i.label}
          </Link>
        ))}
        <a href={FUOBE_REPO} target="_blank" rel="noopener" className={link}>
          GitHub
        </a>
      </nav>
    </footer>
  );
}
