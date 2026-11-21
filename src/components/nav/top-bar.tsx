"use client";

import { Aperture, Clapperboard, Film, Images, LayoutGrid, MessagesSquare, Network, Plus, Search, WandSparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { IntentLink } from "@/components/intent-link";
import { Kbd } from "@/components/ui/kbd";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { areaOfPath, areaPageOf, type AreaId } from "@/lib/nav-areas";
import { activeEntry } from "@/lib/nav-model";
import { isPlainClick, useTappedTab } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { useNavUi, useViewerKind } from "./nav-ui";
import { useSearchPalette } from "./search-context";
import { UpdateAvailable } from "@/components/update-available";
import { BarPills } from "./status-chips";
import { NavPrefetcher } from "./nav-prefetch";
import type { FetchedMegaId } from "@/lib/mega-menus";
import { loadMenusNow, saveData } from "./mega-data";
import { MegaLauncher, preloadMegaPanel, primeMegaPanels } from "./mega-launcher";
import { BarIndicator, BarMenusProvider, BarScrim, BarStage, CloseMenusOnRoute, useBarController } from "./bar-menus";
import { ViewerSlot } from "./viewer-slot";

export { prefetchHrefs } from "./nav-prefetch";

/*
 * The top bar (md and up): two rows that stay on screen as the page scrolls, 101 px on every page (--chrome-top,
 * globals.css).
 *   the top row     the wordmark; search in the middle of the room left (a field from 220 px of room, up to 520 px
 *                   wide, else an icon button); the pills, New creation and who is looking
 *   the second row  every item, centred, in three groups: Create and Studios; Fuobe FX, Apps and Motions & effects;
 *                   Canvas, Chat and Library. Each with its icon from lg; the open page's item is a soft fill
 *                   (nav-states.css).
 * Every item shows at every width from md (the row needs about 750 px below lg and 930 px from lg), so nothing folds
 * away; a row too narrow for them (a very large text size) scrolls sideways rather than wrap. Below md the phone tabs take
 * over (phone-tabs.tsx).
 */

/**
 * A plain bar link (Chat, Library). Its states are the nav's (nav-states.css): the highlight on hover or keyboard
 * focus, and for the open page (aria-current) the tab's soft fill. The items with a menu are BAR_TRIGGER (bar-split.tsx).
 */
export const BAR_ITEM =
  "nav-row group/bar-item inline-flex h-10 shrink-0 [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] whitespace-nowrap text-foreground/80 nav-hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground data-[active]:font-semibold data-[active]:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground min-[1600px]:px-3.5";

/**
 * Which bar item holds the open page, one item per page (areaOfPath): Create for the create tools, Studios for a studio
 * or one of its tools, Apps for the apps, Motions & effects for both galleries, each for its own area page; Canvas,
 * Chat (and Assist's pages) and Library for theirs. `page`: the area whose own page this is (its name is marked aria-current).
 */
export function barActive(pathname: string): {
  create: boolean;
  studios: boolean;
  apps: boolean;
  motions: boolean;
  /** Fuobe FX: its studios and their modes (FX_HOME). */
  fx: boolean;
  canvas: boolean;
  /** /canvas itself (the Canvas item's own page). */
  canvasHome: boolean;
  chat: boolean;
  library: boolean;
  page: AreaId | undefined;
} {
  const e = pathname ? activeEntry(pathname, new URLSearchParams()) : undefined;
  const area = pathname ? areaOfPath(pathname) : undefined;
  return {
    create: area === "create",
    studios: area === "studios",
    apps: area === "apps",
    motions: area === "motions",
    fx: area === "fx",
    canvas: e?.id === "canvas",
    canvasHome: pathname === "/canvas",
    chat: e?.id === "chat",
    library: e?.kind === "library",
    page: pathname ? areaPageOf(pathname) : undefined,
  };
}

type Active = ReturnType<typeof barActive>;
const NONE: Active = barActive("");

/** A tab's icon: from lg, where the row has room for them. The open page's turns the mark colour (nav-states.css). */
const TAB_ICON = "nav-icon hidden size-4 shrink-0 text-muted-foreground group-hover/bar-item:text-foreground group-data-[open]/bar-item:text-foreground lg:block";

/** The line between the row's groups. */
function GroupLine() {
  return <span aria-hidden data-bar-group-line="" className="mx-1.5 h-4 w-px shrink-0 bg-border" />;
}

/**
 * The bar's links and menus, with the open page's item marked (`active`). `onTap`: a link was clicked, so it is marked
 * from the next frame on, before its page arrives.
 */
function BarLinks({ active, onTap }: { active: Active; onTap?: (href: string) => void }) {
  const cur = (on: boolean) => (on ? "page" : undefined);
  const tap = (href: string) => (e: React.MouseEvent) => isPlainClick(e) && onTap?.(href);
  return (
    <>
      {/* An item is marked anywhere in its area, its own page (/create, /studios …) included. */}
      <MegaLauncher id="create" icon={<WandSparkles aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.create || active.page === "create"} />
      <MegaLauncher id="studios" icon={<Clapperboard aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.studios || active.page === "studios"} />
      <GroupLine />
      <MegaLauncher id="fx" icon={<Aperture aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.fx || active.page === "fx"} />
      <MegaLauncher id="apps" icon={<LayoutGrid aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.apps || active.page === "apps"} />
      <MegaLauncher id="motions" icon={<Film aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.motions || active.page === "motions"} />
      <GroupLine />
      <MegaLauncher id="canvas" icon={<Network aria-hidden className={cn(TAB_ICON, "mr-0.5")} />} active={active.canvas || active.canvasHome} />
      <IntentLink href="/chat" eager data-bar-item="" onClick={tap("/chat")} aria-current={cur(active.chat)} className={BAR_ITEM}>
        <MessagesSquare aria-hidden className={TAB_ICON} />
        Chat
      </IntentLink>
      <IntentLink href="/library" eager data-bar-item="" onClick={tap("/library")} aria-current={cur(active.library)} className={BAR_ITEM}>
        <Images aria-hidden className={TAB_ICON} />
        Library
      </IntentLink>
    </>
  );
}

/** Reads the path (runtime data) inside Suspense, so the shell still prerenders; the fallback marks nothing. */
function ActiveBarLinks() {
  const pathname = usePathname();
  const [tapped, onTap] = useTappedTab<string>(pathname);
  return <BarLinks active={barActive(tapped ?? pathname)} onTap={onTap} />;
}

/**
 * Search, in the middle of the top row: a field from 220 px of room (its container, barsearch), up to 520 px wide; an
 * icon button where the right side leaves less. Opens the palette; hover or focus starts loading it.
 */
function SearchField() {
  const search = useSearchPalette();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-keyshortcuts="/ Meta+K Control+K"
      onClick={() => search.open()}
      onPointerEnter={() => search.warm()}
      onFocus={() => search.warm()}
      className={cn(
        "nav-focus inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] text-[13.5px] [@media(pointer:coarse)]:h-11 text-muted-foreground motion-safe:transition-colors",
        "w-10 justify-center nav-hover:bg-[var(--nav-hi)] nav-hover:text-foreground active:bg-[var(--nav-press)]",
        "@min-[220px]/barsearch:w-full @min-[220px]/barsearch:max-w-[520px] @min-[220px]/barsearch:justify-start @min-[220px]/barsearch:border @min-[220px]/barsearch:border-input @min-[220px]/barsearch:bg-background/60 @min-[220px]/barsearch:px-3 @min-[220px]/barsearch:nav-hover:border-border-strong @min-[220px]/barsearch:nav-hover:bg-background @min-[220px]/barsearch:active:bg-background",
      )}
    >
      <Search aria-hidden className="size-[18px] shrink-0 lg:size-4" />
      {/* Its name is the words it shows: "Search Fuobe", the longer line from 340 px of room (sr-only as an icon button).
          One line always: not-sr-only would let it wrap. */}
      <span className="sr-only min-w-0 flex-1 truncate text-left @min-[220px]/barsearch:not-sr-only @min-[220px]/barsearch:whitespace-nowrap">
        <span className="@min-[340px]/barsearch:hidden">Search Fuobe</span>
        <span className="hidden @min-[340px]/barsearch:inline">Search studios, apps, effects…</span>
      </span>
      <Kbd aria-hidden className="hidden @min-[220px]/barsearch:inline-flex [@media(hover:none)]:hidden">
        /
      </Kbd>
    </button>
  );
}

/**
 * New creation: Home with a fresh composer. Text from lg; an icon with its name for screen readers at md. Filled for an
 * account or the owner; an outline for a guest (html[data-viewer], set before the first paint), whose one filled button
 * is Sign up.
 */
function NewCreation() {
  return (
    <IntentLink
      href={NEW_CREATION_HREF}
      eager
      className="nav-focus-out inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border-strong px-2.5 text-[14px] font-semibold whitespace-nowrap text-foreground nav-hover:bg-[var(--nav-hi)] active:bg-[var(--nav-press)] [@media(pointer:coarse)]:h-11 [html[data-viewer]:not([data-viewer=guest])_&]:border-transparent [html[data-viewer]:not([data-viewer=guest])_&]:bg-primary [html[data-viewer]:not([data-viewer=guest])_&]:text-primary-foreground [html[data-viewer]:not([data-viewer=guest])_&]:nav-hover:bg-primary/90 [html[data-viewer]:not([data-viewer=guest])_&]:active:bg-primary/85 motion-safe:transition-colors lg:pr-4 lg:pl-3"
    >
      <Plus aria-hidden className="size-[18px]" />
      <span className="sr-only lg:not-sr-only">New creation</span>
    </IntentLink>
  );
}

/** The right-hand cluster's live parts read who is looking once (one subscription for the pills and the avatar). */
function RightCluster() {
  const kind = useViewerKind();
  return (
    <>
      <BarPills kind={kind} />
      <UpdateAvailable />
      <NewCreation />
      <ViewerSlot />
    </>
  );
}

/**
 * Everything the bar's menus need before their first open: the panels' body (its own chunk), the data of the grouped
 * menus, then each of those panels' first screen of pictures, decoded, so the
 * first open and every switch show whole (primeMegaPanels: nearest `x` first, the pointer's place when it came to the
 * bar). A phone loads none (its sheet asks when it shows one); a browser saving data loads only the code.
 */
export function warmBar(x?: number): void {
  if (!window.matchMedia("(min-width: 768px)").matches) return;
  const ids: FetchedMegaId[] = ["fx", "apps", "motions", "canvas"];
  preloadMegaPanel();
  loadMenusNow(ids);
  if (!saveData()) primeMegaPanels(x);
}

/**
 * Soon after the page has loaded (its first media come first; then idle, or 1.5 s at the latest), so the first hover
 * never meets a skeleton. The pointer or focus coming near the bar warms the menus at once (MainNav).
 */
function MenuPrefetch() {
  useEffect(() => {
    let stop = () => {};
    const schedule = () => {
      if (typeof window.requestIdleCallback !== "function") {
        const t = window.setTimeout(() => warmBar(), 300);
        stop = () => window.clearTimeout(t);
        return;
      }
      const h = window.requestIdleCallback(() => warmBar(), { timeout: 1500 });
      stop = () => window.cancelIdleCallback(h);
    };
    if (document.readyState === "complete") schedule();
    else {
      window.addEventListener("load", schedule, { once: true });
      stop = () => window.removeEventListener("load", schedule);
    }
    return () => stop();
  }, []);
  return null;
}

/**
 * The main nav, the bar's second row: its keys (Left and Right along the items); the first pointer or focus near it warms
 * the menus (warmBar), if the page's idle time has not already. Centred (safe: a row wider than the window starts at its
 * left edge and scrolls).
 */
function MainNav({ children }: { children: React.ReactNode }) {
  const ctl = useBarController();
  const warmed = useRef(false);
  const warm = (x?: number) => {
    if (warmed.current) return;
    warmed.current = true;
    warmBar(x);
  };
  return (
    <nav
      aria-label="Main"
      data-main-nav
      className="flex h-11 shrink-0 items-center justify-center-safe gap-0.5 overflow-x-auto px-4 [scrollbar-width:none] lg:max-[1439.98px]:px-5 min-[1440px]:px-6 [&::-webkit-scrollbar]:hidden"
      onKeyDown={(e) => ctl?.navKey(e)}
      onPointerEnter={(e) => warm(e.clientX)}
      onFocus={() => warm()}
    >
      {children}
    </nav>
  );
}

/** The bar's header, two rows: marked while a menu is open (the items' own hover fill steps aside for the open highlight). */
function BarHeader({ children }: { children: React.ReactNode }) {
  const { openMenu } = useNavUi();
  return (
    <header
      data-top-bar
      data-menu-open={openMenu ? "" : undefined}
      className="sticky top-0 z-40 hidden flex-col border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md md:flex print:hidden"
    >
      {children}
    </header>
  );
}

/** The bar. Hidden below md and in print; same height on every page, full-screen studios included, and always on screen. */
export function TopBar() {
  return (
    <BarMenusProvider>
      <BarHeader>
        <BarStage />
        <BarIndicator />
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border pr-4 pl-5 lg:max-[1439.98px]:pr-5 min-[1440px]:pr-6">
          <IntentLink href="/" eager aria-label="Fuobe home" className="nav-focus inline-flex h-10 shrink-0 items-center rounded-md px-1 font-heading text-[24px] leading-none">
            Fuobe
          </IntentLink>
          <div data-bar-search-room="" className="@container/barsearch flex min-w-10 flex-1 justify-center px-3 lg:px-6">
            <SearchField />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RightCluster />
          </div>
        </div>
        <MainNav>
          <Suspense fallback={<BarLinks active={NONE} />}>
            <ActiveBarLinks />
          </Suspense>
        </MainNav>
      </BarHeader>
      <BarScrim />
      <Suspense fallback={null}>
        <CloseMenusOnRoute />
      </Suspense>
      <NavPrefetcher />
      <MenuPrefetch />
    </BarMenusProvider>
  );
}
