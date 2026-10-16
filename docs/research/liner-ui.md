# Liner UI research: design language reference for Fuobe

Researched 2026-10-16. Fuobe should borrow how Liner *feels*: a calm, quiet, fast interface built around a composer. It should **not** copy Liner's brand assets: no logo, wordmark, the commercial "ABC Arizona Flare" font, its dark-green brand color, illustrations, Lottie animations or marketing copy.

Labels used in this document:

- **[exact]**: the value was read directly from Liner's production CSS, HTML or JS bundles.
- **[i18n]**: the text comes from Liner's shipped UI-string dictionary, which is embedded in the page JSON.
- **[inferred]**: reconstructed from the server-rendered markup, CSS class names or strings, not from a screenshot of a logged-in session.
- **[estimated]**: my own judgement or approximation.

---

## 1. What "liner.app" is, and the pages examined

### 1.1 The domain question

| URL | Result (2026-10-16) | Meaning |
|---|---|---|
| `https://liner.app` (and `www.`, `http://`) | `302` to `https://www.fortune.domains/name/Liner.app`, which is behind a Cloudflare challenge and returns `403` to fetchers | **liner.app is a parked domain listed for sale on a domain marketplace.** It is not a product. |
| `https://getliner.com` | `410 Gone` | This was Liner's legacy domain. Liner moved to the exact-match **liner.com** around its 2024 Series B ([domaininvesting.com](https://domaininvesting.com/liner-acquires-liner-com/), [smartbranding.com](https://smartbranding.com/liner-secures-29-million-in-series-b-funding-upgrades-to-liner-com/)). |
| `https://liner.com` | `200`. Next.js marketing site, "AI agents for professionals" | This is Liner, the AI research assistant (Search, Scholar and Write). The company's social handle is `@liner_app`, which is probably where "liner.app" came from. |
| `https://app.liner.com` | `200`. Next.js app shell, title "Liner" | This is the real **Search app**: sidebar, home composer and source collections. |
| `https://scholar.liner.com`, `https://write.liner.com` | `200`. The same shell, branded per product | These are the Scholar (research agent) and Write (drafting) apps. |

**Conclusion:** the reference product is **Liner (liner.com / app.liner.com)**, the AI search and research assistant. It began as a web highlighter and was rebranded in June 2025: blue was replaced by dark green, a serif display face was added, and a dotted-line citation motif was introduced ([liner.com/learn/rebranding](https://liner.com/learn/rebranding)).

### 1.2 Pages and assets examined

| What | URL | Used for |
|---|---|---|
| Marketing home | https://liner.com/ | IA, CTA styles, i18n dictionary (about 6,100 UI strings) |
| Product pages | https://liner.com/search, https://liner.com/scholar, https://liner.com/write | Marketing patterns, product taxonomy |
| Search app shell (logged out) | https://app.liner.com/ | Sidebar, frame, header and home composer markup [exact] |
| Library page shell | https://app.liner.com/workspace/collections | Library/"Source collection" page, banner card, loader [exact] |
| Scholar app shell | https://scholar.liner.com/ | Sidebar IA: "New chat / Projects / My library / Agents" [exact] |
| Write app shell | https://write.liner.com/ | Sidebar search, "New draft", profile button [exact] |
| Token CSS (app) | `https://static.liner.com/_next/static/chunks/0mwxnc~9e-nj9.css` | Primitive and semantic tokens, light and dark [exact] |
| Component CSS (app) | `.../chunks/016ig9i0l9ne5.css`, `.../chunks/0sfsojte~97u3.css` | Buttons, inputs, tabs, segmented control, chips, menus, dialog, tooltip, loaders, answer markdown [exact] |
| Utility CSS (app) | `.../chunks/0zugcg72qhc~p.css` (Tailwind **v4**), `.../chunks/09zvisxu1noaj.css` (Radix Themes) | Breakpoints, animations, shimmer [exact] |
| Marketing CSS | https://liner.com/_next/static/css/6c495c79df712e66.css (Tailwind v4.3.3), `0a6d33d4933005ab.css`, `2216903e6fb2dcdf.css` | Same token set, typography classes [exact] |
| Fonts | `https://assets.liner.com/fonts/arizona-flare/ABCArizonaFlare.css`, Pretendard v1.3.9 via jsDelivr, `.../elice-dx-neolli/EliceDXNeolli.css`, Google Fonts "Charis SIL" | Type stack [exact] |
| App JS | 78 chunks under `https://static.liner.com/_next/static/chunks/` | Libraries (Sonner, vaul, Quill, Tiptap, Lottie, zustand/jotai), toast config, intent-nudge logic [exact] |

**Limits of this research:**

- I could not view logged-in screens (a thread with an answer, a populated library, the model picker). Those are reconstructed from Liner's UI-string dictionary, CSS and component class names, and are marked **[inferred]**.
- Searches on Mobbin, Dribbble, Product Hunt and YouTube returned no usable UI write-ups.
- Third-party reviews only say the interface is "clean, uncluttered" ([aichatdaily](https://www.aichatdaily.com/tools/liner), [aisotools](https://aisotools.com/blog/liner-ai-review-2026)).

---

## 2. Extracted design tokens

### 2.1 Token architecture [exact]

Liner's design system (its CSS layer is named `prism`; the icon variables are `--prism-icon-*`) has three tiers:

1. **Primitives:** `--lp-pri-*`. These are color ramps, sizes, opacities, font sizes, line heights, weights and motion values.
2. **System tokens:** `--lp-sys-*`. These are space, radius, icon size, shadow and motion roles.
3. **Semantic color roles:** `--surface-*`, `--label-*`, `--border-*`, `--control-fill-*`, `--brand*`, `--positive/negative/caution`, `--focus`, `--link` and `--overlay-dim`.

They are switched in two ways:

- **Theme:** `:root[color-theme=light|dark]` (also `.light`/`.dark`).
- **Product brand:** `:root[data-service-domain=search|scholar|write|finance]` swaps only the `--lp-pri-brand-*` ramp. One component library serves four color-coded products.

Semantic names follow the pattern `role-tone-intensity-state`, for example `control-fill-neutral-alpha-lowest-hover`. Tailwind v4 exposes them as `bg-surface-neutral-low`, `text-label-neutral-secondary`, `rounded-medium-small`, `p-150` and so on.

**Takeaway for Fuobe:** shadcn's flat variable set (`--background`, `--muted`, and so on) is enough. Add a few semantic extras (brand-faint, highlight, overlay, elevation) rather than building the full three-tier system.

### 2.2 Typography [exact]

| Role | Liner font | Notes |
|---|---|---|
| UI and body | **Pretendard Variable** (with Pretendard JP Variable) | Pretendard's Latin glyphs are derived from **Inter**. Fallback stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif`. |
| Display / "accent" titles (English) | **ABC Arizona Flare** (`font-family: Flare`), a commercial serif | Used at weight **400** with `letter-spacing: -0.03em` and line height 110–120%. It is also used for the **user's question** in a thread (`#userQuestion`). |
| Korean display | Elice DX Neolli | (Locale-specific.) |
| Editor serif (Write) | Charis SIL (Google Fonts) | Long-form document editing. |
| Mono | `ui-monospace, SFMono-Regular, Menlo…` | |

**Type scale.** Class names are `.lp-sys-typo-{role}{n}-{style}-{weight}`. Primitive sizes are 8, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 32, 34, 40, 42, 52, 54, 56, 64 and 72 px.

| Token | Size / line height / weight | Typical use |
|---|---|---|
| display2-accent | 54px / 110% / 400 serif (52px / 700 sans in other locales) | Marketing hero |
| display3-accent | 42px / 120% / 400 serif | Marketing section titles |
| title1-accent | **34px / 120% / 400 serif, −0.03em** | App home hero ("Looking for facts?") |
| title2/3-accent | 30 / 26px serif | Dialog and page heroes |
| title4-accent | **22px / 120% serif** | Page titles ("Source collection") |
| title5-accent | 20px / 130% serif | Card titles |
| title1–5-normal | 32 / 28 / 24 / 20 / 18px, weight 500, 130% | Sans headings |
| heading3/4/6-answer | 22 / 20 / 16px, 600, 150% | Headings inside AI answers |
| paragraph1–4 | 17 / 16 / 15 / **14px**, 400/500/600, 130% (UI) or 150% ("post") | Body. 14px is the default UI size. |
| paragraph2-answer | **16px / 160%** | Answer body (the markdown module uses 15px / 170%) |
| caption1–3 | **13** / 12 / 11px, 130% | Sidebar rows (13px), meta text, badges |
| Composer input | **16px / 1.6**, min line 26px | Prompt editor (16px also prevents iOS zoom) |

Weights in use: 300, 400, 500, 600 and 700. Font smoothing is `antialiased` on hero titles.

### 2.3 Color: neutral ramp ("gray-cool") [exact hex; oklch computed]

Liner's neutrals have a very faint violet-blue cast (hue about 286, chroma 0.001–0.005). That is almost exactly Tailwind's **zinc** scale.

| Token | Hex | oklch |
|---|---|---|
| gray-cool-100 | `#fafafb` | `oklch(0.985 0.001 286)` |
| gray-cool-200 | `#f1f1f2` | `oklch(0.958 0.001 286)` |
| gray-cool-300 | `#e8e8e9` | `oklch(0.931 0.001 286)` |
| gray-cool-400 | `#d2d2d4` | `oklch(0.864 0.003 286)` |
| gray-cool-500 | `#bdbdc0` | `oklch(0.799 0.004 286)` |
| gray-cool-600 | `#a9a9ab` | `oklch(0.735 0.003 286)` |
| gray-cool-700 | `#959597` | `oklch(0.670 0.003 286)` |
| gray-cool-800 | `#818184` | `oklch(0.604 0.004 286)` |
| gray-cool-900 | `#6e6e71` | `oklch(0.539 0.005 286)` |
| gray-cool-1000 | `#5c5c5f` | `oklch(0.476 0.005 286)` |
| gray-cool-1100 | `#4a4a4d` | `oklch(0.410 0.005 286)` |
| gray-cool-1200 | `#39393b` | `oklch(0.345 0.003 286)` |
| gray-cool-1300 | `#2b2b2d` | `oklch(0.290 0.004 286)` |
| gray-cool-1400 | `#1e1e1f` | `oklch(0.235 0.002 286)` |
| gray-cool-1500 | `#121213` | `oklch(0.183 0.002 286)` |
| gray-cool-1600 | `#060606` | `oklch(0.122 0 0)` |

**Alpha ramps.** Alpha ramps exist for white, black, gray (`#949497`) and yellow, at 0, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 44, 48, 56, 64, 72 and 80%. Hover, pressed and border states are built almost entirely from **translucent gray** (8% hover, 12% pressed, 12% subtle border, 24% normal border, 48% strong border). Because of that, the same component works on any surface.

### 2.4 Color: semantic roles, light and dark [exact]

| Role | Light | Dark |
|---|---|---|
| `surface-neutral-lowest` (page / main canvas) | `#ffffff` | `#1e1e1f` |
| `surface-neutral-low` (app frame and sidebar) | `#fafafb` | `#2b2b2d` |
| `surface-neutral-mid` (segmented control track, tab panel) | `#f1f1f2` | `#39393b` |
| `surface-floating` (popover) | `#ffffff` | `#39393b` |
| `surface-modal` | `#ffffff` | `#1e1e1f` |
| `label-neutral-base` (text) | `#1e1e1f` | `#ffffff` |
| `label-neutral-secondary` | `#818184` | `#a9a9ab` |
| `label-neutral-tertiary` (placeholder) | `#bdbdc0` | `#5c5c5f` |
| `label-neutral-quaternary` | `#d2d2d4` | `#4a4a4d` |
| `border-neutral-alpha-subtle` / `-normal` / `-strong` | gray 12% / 24% / 48% | same |
| `border-neutral-subtle` (opaque dividers) | `#e8e8e9` | `#4a4a4d` |
| `control-fill-neutral-hover` | gray 8% | white 8% |
| `control-fill-neutral-selected` | black 8% | white 12% |
| `control-fill-neutral-low` (active sidebar row) | `#f1f1f2` | `#2b2b2d` |
| `surface-inverse-static-high` (tooltip) | `#39393b` | `#39393b` |
| `focus` (focus-visible outline) | `#00a0f0` (cyan-600), **1px** | same |
| `link` | `#007dbe` | `#39b1ff` |
| `highlight` (text highlight) | `#f5ffda` (lime-100) | `#2f4000` |
| `overlay-dim` | black 48% | black 64% |
| `positive-base` / `negative-base` / `caution-base` | `#348b3e` / `#dd0018` / `#c56c00` | `#44b151` / `#ff5048` / `#f58800` |
| `disabled` fill / label | `#f1f1f2` / `#bdbdc0` | `#2b2b2d` / `#5c5c5f` |

**Brand ramps.** Each product has its own 16-step ramp. Primary buttons use `control-fill-brand` (step 900 in light, 800 in dark) with **white** text in both themes. Brand text uses step 800 in light and 700 in dark.

| Product (`data-service-domain`) | Fill (light) | Fill (dark) | Label | Accent (cream-ish) |
|---|---|---|---|---|
| search (the main "Liner" brand) | `#2c783c` (forest green) | `#349749` | `#349749` | `#ffeccd` |
| scholar | `#616715` (olive) | `#767d1b` | `#767d1b` | `#ffe8e8` |
| write | `#08759c` (teal-blue) | `#0a8bbb` | `#0a8bbb` | `#f9f3a6` |
| finance | `#2c5dbc` (blue) | `#356dd4` | `#356dd4` | `#d4f6fa` |

- **Accent labels** (category colors): yellow `#ffcc00`, mint `#00acac`, cyan `#00a0f0`, purple `#ac00e9` and pink `#ff457d`.
- **Library banner tint:** background `#F5FAF7`, border `#14371B0A` (4% dark green).
- **Answer markdown:**
  - inline code: text `#efa032` on `#f6f6f6`
  - table borders: `#e9edf2`
  - highlighted text: `#fef8db` (dark `#5f5a3f`)
  - legacy markdown links: `#4058ff`

### 2.5 Radius, spacing and sizes [exact]

| Radius token | px | Used for |
|---|---|---|
| 2x-small | 2 | (rare) |
| extra-small | 4 | Keycaps, checkbox, small badges, inline code |
| small | 6 | Sidebar rows, 24px buttons, product-switch chips |
| medium-small | 8 | 32px buttons and inputs, menu items, banner card |
| **medium** | **10** | 40px buttons and inputs, tooltip, collapsible, tab panel |
| large | 12 | 48px buttons and inputs, **dialog**, **main-sheet corners**, answer tables |
| extra-large | 14 | Large segmented control, auth card |
| 2x-large | 200 (pill) | Marketing CTAs, composer icon buttons, chips |
| full | 9999 | Avatars, rounded badges, tab indicator |
| (composer) | **28** (desktop) / **20** (under 600px) | Main prompt box |

- **Spacing** (`--lp-sys-space-*`): 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64 and 80 px. These are named 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1600 and 2000. Liner leans heavily on 6, 8 and 12 inside controls and 16, 24 and 40 between groups.
- **Control heights:** **24 / 32 / 40 / 48** (small, medium, large, extra-large). The same values apply to buttons, square icon buttons, inputs (32/40/48) and segmented items (24/32/40). Chips and tags come in 16 / 24 / 32 / 40.
- **Icon sizes:** 10, 16, 20, 24, 32 and 40. Sidebar and composer glyphs render at **16px** inside 32–40px hit areas.
- **Layout widths:**
  - sidebar: **48px** collapsed rail, **260px** expanded
  - composer / content column: **720px** max (some views 760 or 800)
  - dialog: **400px** default (`max-width: calc(100% - 32px)`, `max-height: 90vh`)
  - containers: 600 / 1024 / 1366 / 1536

### 2.6 Shadows (elevation) [exact]

| Token | Light | Dark | Used for |
|---|---|---|---|
| `shadow-soft` | `0 4px 12px #0000000d` | `0 6px 12px #0003` | **Composer**, segmented-control thumb |
| `shadow-normal` | `0 0 1px #0000000f, 0 1px 8px #0000000f, 0 2px 12px #00000014` | `0 0 1px #00000038, 0 1px 8px #00000038, 0 2px 16px #00000042` | Dialogs, popovers, cards on hover |
| `shadow-strong` | `0 6px 16px #0000001f, 0 4px 12px #00000014, 0 0 8px #00000014` | 3× alpha | Menus, floating panels |
| `shadow-heavy` | `0 16px 20px #0000001f, 0 8px 16px #00000014, 0 0 8px #00000014` | 3× alpha | Drag ghosts, full-screen sheets |
| Main sheet edge | `-2px 0 6px rgba(0,0,0,.02)` and a 0.5px left border | | Content area inset into the frame |

Liner's shadows are **very soft and layered**: there is always a 1px "contact" layer plus a diffuse blur. There are no hard drop shadows.

### 2.7 Motion [exact]

| Primitive | Value |
|---|---|
| Durations | 50, 100, 150, 200, 250, 300, 400, 500, 600 ms |
| Easing "inviting" (enter, expand) | `cubic-bezier(.08,.82,.17,1)`, a strong ease-out |
| Easing "seamless" (exit, collapse) | `cubic-bezier(.3,0,1,1)`, an ease-in |
| Easing "purposeful" (move, press, hover) | `cubic-bezier(.36,0,.12,1)` |
| Springs, as CSS `linear()` curves | precise 306ms, standard 376ms (indicator), expressive 433ms (emphasis) |

| Semantic role | Duration / easing |
|---|---|
| hover, press | **100ms**, purposeful |
| exit | 150ms, seamless |
| enter, collapse | **200ms** |
| move | 250ms |
| expand | 300ms, inviting |
| page transition | 400ms |

**Keyframes and usages:**

- **Dialog overlay:** fade, 150–200ms ease-out.
- **Dialog card:** `opacity 0, translateY(8px)` to rest, 260ms `cubic-bezier(.33,1,.68,1)`. The older module used `scale(.96)` and 150ms.
- **Popover / dropdown:** `fadeScaleIn`, `scale(.95)` to 1, **120ms** ease-out.
- **Tooltip:** `slideIn`, `translateY(10px)`, 300ms `cubic-bezier(.25,.46,.45,.94)`.
- **Accordion:** 300ms `cubic-bezier(.87,0,.13,1)`.
- **Source items appearing:** `pg-source-fade-in`, `translateY(4px)` plus fade.
- **Streaming "thinking" text:** `shimmer-text`, a mask-position sweep over 2.5s ease-in-out infinite.
- **Skeletons:** `lcs-skeleton-shimmer`, a 90° white-50% gradient sweep over 1.4s ease-in-out.
- **Typing caret:** 1px wide in the brand color, blinking with 1s `step-end`.
- **Dots loader:** 3–4 square dots of 2–7px with 1px radius, 1s fade loop, staggered 0 / 0.1 / 0.2 / 0.3s.
- **Spinner:** ring with a clip-path sweep, 24 or 32px.
- **Sidebar:** width transition 150ms. Rail buttons fade in over 300ms ease-out.
- **Toast:** Sonner default slide.
- **Promo banner:** `clip-path` unfold.
- **Reduced motion:** `motion-safe:` and `motion-reduce:` variants are used.

### 2.8 Breakpoints [exact]

| Breakpoint | Width | What changes |
|---|---|---|
| `s` | 600px | Below 600: full-bleed mobile layout, composer radius 20px, dialog actions stack. |
| `m` | 1024px | Below 1024: **sidebar hidden** and replaced by a hamburger and an overlay drawer; the main sheet loses its rounded corners. |
| `l` | 1366px | Container 3. |
| `xxl` | 1920px | Extra-wide adjustments. |

Hover styles are wrapped in `@media (hover:hover)`, so touch devices never get "sticky hover".

### 2.9 Icons [exact, with a match recommendation]

Liner uses a **custom icon set**:

- 24×24 viewBox, rendered at 16px.
- Built from filled paths that imitate **1.5px strokes with square (butt) terminals and sharp corners**. For example, the "+" is two 1.5px-thick bars.
- Colored with `currentColor`, with a `--prism-icon-knockout` variable for two-tone glyphs.
- Glyphs seen: hamburger (3 bars), plus, folder, download tray, sidebar-panel toggle and microphone.

**Closest free equivalents:** Lucide with `strokeWidth={1.5}` at `size={16}` (already the shadcn default library), or Remix Icon "line", which is built from fills and has squarer terminals.

### 2.10 Libraries in the bundle [exact]

| Concern | Library |
|---|---|
| Framework and styling | Next.js, Tailwind CSS v4, CSS Modules (SCSS), Radix primitives and Radix Themes layout (`rt-Flex`) |
| Toasts | **Sonner**: `position="top-center"`, `gap={8}`, `offset={29}`, promise toasts with `duration: 4000` |
| Drawers | **vaul**, plus a small CSS drawer for the mobile sidebar |
| Editors | **Quill** for the prompt input (one line growing to many, slash commands); **Tiptap/ProseMirror** for the Write document editor |
| State | zustand and jotai |
| Media and other | Lottie (feature tours and onboarding, 16:9 and 4:3), `@artsy/fresnel` (responsive SSR), Amplitude |

All of these map directly onto shadcn/ui, which is also built on Radix, Sonner, vaul and cmdk.

---

## 3. Layout and component patterns (rebuild with shadcn/ui)

### 3.1 App shell: a "frame and inset sheet" [exact]

```
┌──────────────────────────────────────────────────────────────────────┐ body / frame: surface-neutral-low #fafafb
│ ┌────┐ ╭───────────────────────────────────────────────────────────╮ │
│ │ ≡  │ │ header 64px sticky (white)                       [actions]│ │
│ │ ✎  │ │                                                           │ │
│ │ 🗀  │ │                 main: white sheet (#fff)                  │ │ sheet: rounded-tl/bl 12px,
│ │    │ │                                                           │ │ border-l 0.5px #e8e8e9,
│ │    │ │                                                           │ │ shadow -2px 0 6px rgba(0,0,0,.02)
│ │ ⤓  │ │                                                           │ │
│ └────┘ ╰───────────────────────────────────────────────────────────╯ │
└──────────────────────────────────────────────────────────────────────┘
 rail 48px (expands to 260px)
```

- The **frame** (sidebar background and app background) is one tint darker than the **sheet** that holds content. The sheet's left corners are rounded (12px) and it has a hairline left border plus an almost invisible left shadow. This one detail gives the "calm, premium" feel.
- The sheet scrolls by itself (`overflow-y:auto` with the scrollbar hidden), and the header is `sticky top-0` inside it.
- In dark mode the relationship is the same, but the frame (`#2b2b2d`) is lighter than the sheet (`#1e1e1f`).

**shadcn mapping:** `SidebarProvider` with `Sidebar variant="inset" collapsible="icon"` and `SidebarInset`. shadcn's *inset* variant is exactly this pattern. Restyle `SidebarInset` to:

```
md:rounded-l-xl md:rounded-r-none md:shadow-[-2px_0_6px_rgba(0,0,0,.02)] md:border-l-[0.5px] md:m-0
```

Set `--sidebar-width: 260px` and `--sidebar-width-icon: 48px`.

### 3.2 Sidebar [exact markup, inferred behavior]

**Collapsed rail (48px).** The rail uses `px-6 py-12 gap-8` with items centered.

1. A 36px **toggle**. It shows the logo mark, which swaps to a "panel-expand" icon on hover (`group-hover`). The **whole rail is clickable to expand** and shows `cursor: e-resize`.
2. A 32px "New question" icon button.
3. Section shortcuts (32px icon links, for example "Source collection").
4. Bottom area: a `border-t` divider, then ghost 32px icon buttons (Download app).

Every rail button uses `rounded-8` (`rounded-md`) with hover `bg-control-fill-neutral-hover` (gray 8%). There is **no border and no shadow**. Tooltips show the labels.

**Expanded panel (260px).** The panel uses `pt-12 px-8 pb-8`.

1. **Header row (36px):** logo / Home link on the left and a "Show less" collapse button (36px) on the right.
2. **Primary action row:** "New question" (Search), "New chat" (Scholar) or "New draft" (Write). Specs: `min-h-32`, `px-8`, `gap-8`, `rounded-6`, 16px icon, 13px label. On the right it shows **keyboard keycaps**: two 20×20 tiles, `rounded-4`, `bg-control-fill-neutral-mid`, for ⌘ and K. Write shows this action as a bordered 36px button with a dropdown instead.
3. **Optional search field** (Write): 32px input, `rounded-8`, leading 14px icon, placeholder "Search".
4. **Sections**, stacked with `gap-16`. Scholar shows "Projects", "My library" and "Agents". Search shows "Source collection" and history. Rows are **32px**, `rounded-6`, `px-8`, `gap-8`, 13px. The **active row** gets `bg-control-fill-neutral-low` (`#f1f1f2`) and a **semibold 13px** label (caption1-bold). There is no accent bar and no colored text.
5. **Footer.** It sits on the frame background with `border-t` and `px-16 pb-16 pt-10`.
   - A **profile button**: 42px tall, 24px round avatar with an inset 1px alpha border, name, and a chevron that opens a dialog.
   - A settings ghost icon button.
   - A **product switcher**: two equal-width outlined chips (32px, `rounded-6`, white fill, `border-neutral-alpha-normal`, 13px label with a product icon, opening in a new tab) and a 32px square "more" button.

**Mobile (under 1024px).** The rail is removed. The header shows a 40px hamburger icon button that opens the sidebar as an overlay drawer with a dim backdrop.

**shadcn mapping:**

| Liner element | shadcn component and styling |
|---|---|
| Sidebar header | `SidebarHeader`: logo plus `SidebarTrigger` |
| Primary action row | `SidebarMenuButton size="sm"` with `<Kbd>` keycaps |
| Sections | `SidebarGroup` / `SidebarGroupLabel` / `SidebarMenu` |
| Active row | `SidebarMenuButton isActive` styled as `data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold` |
| Footer | `SidebarFooter` with a `DropdownMenu` on the user button |
| Rail click-to-expand | `SidebarRail`, or an `onClick` on the collapsed `SidebarContent` |
| Mobile drawer | Built in: shadcn renders a `Sheet` on mobile |

### 3.3 Header [exact]

- Height **64px**, sticky, `bg-background`.
- Padding: `pl-12 pr-20` on mobile, `px-24` on desktop.
- Left: the mobile hamburger, or breadcrumbs and a thread title.
- Right: a `gap-8` cluster of ghost and outline actions (Share, the "Go to space" button, credits).
- No bottom border at rest. A border or shadow appears only once content scrolls under it [inferred].

### 3.4 Home / empty state with the hero composer [exact]

```
                        (26vh top padding)
                      Looking for facts?            ← serif 34px / 400 / -0.03em, centered
                           (40px gap)
      ╭────────────────────────────────────────────────────────╮
      │ (+)  Ask anything                                  (🎙) │  ← composer, max-w 720
      ╰────────────────────────────────────────────────────────╯
           [suggestion] [suggestion] [suggestion] …             ← section max-w 723, gap 8, pt 12
```

- The hero question is personalized for signed-in users: "Looking for facts, {{name}}?" [i18n].
- The hero sits about **26vh** from the top, not vertically centered, so the composer lands in the eye line.
- Mobile: horizontal padding 20px, and the hero copy can break across lines (`whitespace-pre-line`, `break-keep`).

### 3.5 Composer anatomy and states [exact styles, i18n microcopy]

**Container:**

- `min-h-56px`, `p-10px`, `bg-background`, 1px `border-neutral-alpha-subtle` (gray 12%)
- `shadow-soft` (`0 4px 12px rgb(0 0 0 / 5%)`)
- radius **28px** (20px under 600px), `max-w-720`
- `focus-within:border-brand + 0 0 0 4px var(--control-fill-brand-faint)`: a brand-colored border plus a 4px faint brand halo

**Row layout (`gap-4`, items centered):**

1. **Left:** a 40px **round outline icon button** ("+") in tertiary gray. It opens the attach/tools menu: "Upload files", "Papers", "Source collection", "Find people" [i18n].
2. **Middle:** a rich-text editor (Quill) with `px-10 py-5`, 16px / 1.6, a 26px minimum line, auto-grow, and placeholder text in `label-neutral-tertiary`.
3. **Right:** a 40px **round ghost icon button**. It shows a microphone ("Dictation") while the box is empty and is replaced by **send** when there is text [inferred]. While the answer generates, a "Stop" button is offered [i18n].

**Context-specific placeholders [i18n].** The placeholder doubles as the mode explanation:

- "Ask anything"
- "Ask anything or type / for skills" (slash commands)
- "Describe the draft you want to write (e.g., …)"
- "Upload your data and describe what to analyze"
- "Listening..." (voice mode)

**Attachments:**

- **Drop zone overlays:** dragging files over the page shows a full overlay, "Upload to Liner" or "Upload to thread".
- **Attachment chips** appear above the text with "AI agent cannot read this file/link" warnings.
- **Contextual quick-action chips** appear immediately after attaching: "Summarize this file", "Explain this image", "Extract text", "Solve this homework problem".
- **Limits** are reported in toasts: "Upload up to {{n}} files at a time", "Attach a file less than {{n}}MB", "Files exceeding 25MB cannot be added."

**Mode and model switching [i18n, inferred UI].** These appear as chips or toggles in or under the composer:

- A "Scholarly papers only" switch, plus a "Generate a new thread with scholarly sources" popup when the mode changes mid-thread.
- A **model picker**. It is a dialog with a search field showing "{{n}} results", sections "Starred", "Answer generation" and "Image generation", a **"Credits needed" vs "No credits needed"** label per model, a "Manage" link for starring, and toasts "Added to starred" / "Removed from starred". After a switch, a "You've switched to {{model}}" banner appears. Liner advertises "350 of the latest AI models".

**Intent nudge [exact JS].** If the query contains research keywords (`paper`, `citation`, `literature`, `hypothesis` and others, with a minimum length of 3), a popover suggests a better tool: "Literature Review might handle this one better", with a "Run {{agentName}}" action.

### 3.6 Chips, pills, badges and keycaps [exact]

- **Chip/tag:**
  - 24px: `rounded-6`, `px-4`, gap 4
  - 32px: `rounded-8`, `px-8`
  - 40px: `rounded-8`, `px-8`
  - optional remove "×" with its own padding
  - Variants: subtle (gray 8% fill), outline (alpha-normal border on white), brand-faint (brand 8% fill with brand text).
- **Badge:** small (`min-w-18`, `px-4 py-2`, `r4`), medium (`min-w-20`, `r4`), large (`min-w-25`, `px-6 py-4`, `r6`), or a `rounded` pill variant. `user-select:none` and `cursor:default`.
- **Pill CTAs (marketing):** 48px tall, fully rounded, brand fill ("Search now") or brand-outline with a 5% brand hover tint ("Get started").
- **Keycaps:** 20×20, `rounded-4`, `bg-control-fill-neutral-mid`, glyph at about 10px, shown beside actions in rows and tooltips ("New question ⌘+K", "Files {{shortcut}}", "Editor {{shortcut}}").
- **shadcn mapping:**
  - `Badge` with new `size` variants
  - a custom `Chip` built as a `Toggle` or `Button` with `variant="secondary" size="sm" className="rounded-full h-8 px-3"`
  - `Kbd` (shadcn ships one), restyled to `h-5 min-w-5 rounded-[4px] bg-muted text-[10px]`

### 3.7 Buttons and icon buttons [exact]

| Size | Height | Radius | Notes |
|---|---|---|---|
| xl | 48 | 12 | Marketing and onboarding CTAs (pill on marketing) |
| lg | 40 | 10 | Default app CTA; composer buttons (overridden to pill) |
| md | 32 | 8 | Sidebar and toolbar |
| sm | 24 | 6 | Inline actions in cards |

| Variant | Rest | Hover |
|---|---|---|
| `strong-brand` | Brand fill, white label | Next darker step |
| `outline-brand` | Transparent with a brand border | Brand 12% fill |
| `outline-neutral` | White with a gray-24% border | `#fafafb` |
| `subtle-neutral` | Gray 8% fill | 12% |
| `ghost-neutral` | Transparent | Gray 8% |
| `ghost-neutral-subtle` | Like ghost, with secondary-gray text | Gray 8% |
| `strong-neutral-static-black` | Inverse, black-ish | `#2b2b2d` |
| `text` | Text only | Opacity 0.8 |

- **Disabled:** gray fill (`#f1f1f2`) and `#bdbdc0` text, with `cursor:not-allowed`.
- **Loading:** the button keeps its fill and shows dots.
- **Focus-visible:** a **1px solid focus color** with a 1px offset. It is thin and crisp, not a glow.
- **shadcn mapping:** extend `buttonVariants`. Sizes become `xs` (24, `rounded-md`), `sm` (32, `rounded-lg`), `default` (40, `rounded-[10px]`) and `lg` (48, `rounded-xl`), plus `icon-*`. Variants:
  - `default` = brand
  - `outline` = neutral outline on `bg-background`
  - `secondary` = subtle gray
  - `ghost`
  - `ghost-muted`
  - `inverse`
  - `link`

### 3.8 Segmented control and tabs [exact]

- **Segmented control (mode switch):**
  - Track: `bg-surface-neutral-mid`, `p-4`, `gap-2`, `inline-grid`.
  - Thumb: an absolutely positioned **white indicator with `shadow-soft`** that slides between items using the 376ms spring.
  - Items: `px-12`, height 24/32/40, minimum width 80/100. Off items are secondary gray with a gray-8% hover; the on item is black text.
  - Shapes: pill (`rounded-full`) or square (radius 8/10/12/14 by size).
- **Tabs:**
  - List: `inline-flex`, `gap-8`, horizontally scrollable with the scrollbar hidden, light variant with a `border-bottom` alpha-subtle line.
  - Indicator: a **2px rounded underline** in `label-neutral-base` that slides between tabs.
  - Tab: padding `2px 4px 5px`, `rounded-4`, secondary-gray label that turns base on hover or when active, gray-8% hover background.
  - Panels: `p-16`, `rounded-10`, `bg-surface-neutral-mid`, entering with a 200ms inviting easing.
- **shadcn mapping:**
  - Segmented control: `ToggleGroup type="single"` with a motion indicator. Alternatively use `Tabs` with a `TabsList` styled as a track (`bg-muted p-1 rounded-full`) and `TabsTrigger data-[state=active]:bg-background data-[state=active]:shadow-[var(--elevation-soft)]`.
  - Underline tabs: a second `Tabs` style variant.

### 3.9 Menus, popovers and tooltips [exact]

- **Dropdown / menu item:**
  - `min-h-32`, `py-6 px-8`, `gap-8`, `rounded-8`
  - transparent at rest, gray 8% when hovered or highlighted, 12% when pressed
  - label truncates with an ellipsis
  - container: `bg-popover`, `shadow-strong`, `rounded-12`, `p-4`, opening with **`scale(.95)` to 1 and fade over 120ms ease-out** [container radius and padding estimated]
- **Tooltip:**
  - **inverse dark chip** (`#39393b` in both themes, white text), `rounded-10`
  - shadow `0 2px 12px #0000001a, 0 1px 8px #0000000f, 0 0 1px #0000000f`
  - arrow tinted to match
  - enters with `translateY(10px)` and fade over 300ms
  - usually label plus keycap
- **shadcn mapping:** `DropdownMenu` / `ContextMenu` / `Popover` / `Tooltip`. Set `TooltipContent` to `bg-[oklch(0.345_0.003_286)] text-white rounded-[10px]`, and menu items to `rounded-md px-2 py-1.5 min-h-8 focus:bg-accent`.

### 3.10 Dialogs and drawers [exact]

- **Dialog:**
  - width **400px** (wider variants exist), `rounded-12`, `bg-background`, `shadow-normal`, `max-h-90vh`
  - optional top illustration area (`py-20`)
  - header `p-24 24 12`, `gap-8`, with the title balanced (`text-wrap:balance`) and the description in secondary gray
  - close button at **12px/12px**, absolutely positioned
  - action row `gap-8` with **equal-width buttons** (`flex:1`), or a "hug" variant
  - **under 600px, actions stack in `column-reverse` at full width**, so the primary action is on top
  - overlay: `--overlay-dim` (48% / 64%), fading in over 150ms
  - content: `scale(.96)` with a slight upward translate, 150ms ease-out (or 260ms with an 8px rise)
- **Confirmation copy:** the title is a question ("Delete highlight?", "Discard all changes?", "Leave this collection?"), the body states the consequence ("Deleted source cannot be recovered"), and the buttons are verbs ("Delete", "Discard").
- **Drawer (mobile):** a vaul bottom sheet with `rounded-t-12`, `p-20`, `gap-20` and `shadow-normal`, used for source lists ("Select") and pickers.
- **Glass auth card:** `bg-white/30` (dark `#1E1E1FA6`), `backdrop-blur-lg`, `rounded-14`, `shadow-normal`, `px-32 py-56`, `max-w-504`.
- **shadcn mapping:** `Dialog` (`sm:max-w-[400px] rounded-xl p-0`, with header and footer padding as above, and `DialogFooter` as `grid grid-cols-2 gap-2` / `max-sm:flex-col-reverse`), `AlertDialog` for confirmations, and `Drawer` (vaul) on mobile through a responsive `Dialog`/`Drawer` combo.

### 3.11 Toasts [exact]

- **Sonner** with `position="top-center"`, `gap={8}`, `offset={29}` and a default duration of about 4s.
- One-line copy in past tense or a short imperative: "Copied", "Link copied", "Deleted", "Saved to Starred", "Renamed to {{name}}", "Export complete!", "Failed to save. Please try again."
- Progress toasts for long jobs: "Exporting to {{file_type}}" becomes "Export completed". "{{uploaded}}/{{total}} file(s) uploaded successfully".
- **shadcn mapping:** `<Toaster position="top-center" gap={8} offset={29} />` with `toast.promise(...)`.

### 3.12 Loading and streaming states [exact and i18n]

Liner makes waiting feel productive by **narrating the agent's steps**.

- **Step list (tool calls):** each step is one row.
  - In progress: an icon plus a **present-progressive label with an ellipsis**, rendered as **shimmering text** (mask sweep, 2.5s).
  - Done: the past tense plus a count.

  | In progress | Done |
  |---|---|
  | "Thinking…" | (done) |
  | "Searching web pages" | "Found · {{n}} web pages" |
  | "Reading…" | "Read" |
  | "Checking the facts..." | (done) |
  | "Creating mind map..." | (done) |
  | "Creating review criteria..." | "Created review criteria" |

  Steps can show elapsed time ("{{m}}m {{s}}s"), finish with "Complete", or show "Skipped". Some offer an escape hatch ("Get answer now").
- **Sources stream in** as cards or favicons, each fading up 4px.
- **Answer text streams** with a 1px brand-colored caret blinking at the insertion point. Afterwards a "Polishing to improve accuracy…" pass can run.
- **Skeletons:** a gray block with a white-50% gradient sweep over 1.4s.
- **Dots loader:** three small square dots in the brand color for page and section loads (the library list uses a 400px-tall centered area).
- **Spinner:** a 24 or 32px ring for buttons and blocking states. The Write app's boot screen shows a 40px brand-filled logo mark, centered.
- **Background jobs:** "Answer is being prepared in a new tab. Please ask more questions." The user is never blocked.
- **shadcn mapping:**
  - `Skeleton` with a shimmer class
  - a custom `<Shimmer>` text component (`bg-clip-text` / `mask-image` linear-gradient animated with `mask-position`)
  - shadcn `Spinner` (or a lucide `Loader2` with `animate-spin`)
  - step lists from `Collapsible` with a status icon per row

### 3.13 Thread / answer layout [exact CSS, inferred layout]

- Single centered column, about 720px.
- The **user's question is rendered in the display serif** as the headline of each turn (`#userQuestion` uses the Flare font).
- **Answer typography:**
  - body 15px / 170% (also 16px / 160%)
  - paragraphs separated by 1em
  - lists indented 1.5em with 0.75em between items
  - h1 1.4em and h2 1.25em, with 0.8em margins
  - links in the link color
  - **tables:** separate borders at 0.5px, **radius 12px**, header cells 15px bold with `14px 20px` padding, body cells `12px 20px`, 14px / 20px text, scrolling horizontally
  - inline code: an amber-tinted chip, `r4`, 24px tall
- **Citations** are inline (sentence-level). Liner's 2025 rebrand turned the citation **dotted line** into a brand motif. A sources rail or tab ("Web", "Collections", "Uploaded", "Reliable Sources", "Show {{n}} more sources") sits beside or above the answer.
- **After the answer:**
  - an action row: Copy, Share ("Share link"), Export, "Switch models" / "Compare with other AI", like and dislike (dislike opens a survey: "What didn't work for you?")
  - **refine chips:** "Make It Detailed", "Make It Simple"
  - a **"Follow-ups"** list of suggested questions
  - a docked follow-up composer
- **Selecting answer text** offers inline actions: highlight with color choices ("Change color"), memo, "Ask follow up".

### 3.14 Library ("Source collection", "My library", "My space") [exact and i18n]

- **Page header:** a serif page title (22px) at the top-left of the 720px column. On mobile the hamburger sits beside it.
- **Hero banner card** at the top of an empty or new library:
  - `rounded-8`, a very pale brand tint (`#F5FAF7`) with a 4%-alpha brand border, `px-24`, `py-24` to `py-40`
  - copy on the left: serif 22px title plus 14px secondary line
  - an **illustration on the right** (288×156 on desktop, shrinking to 196×106)
  - on mobile it stacks vertically (`flex-col-reverse`)
- **Empty-state copy:** two lines, a promise and then how.
  - "Gather research materials you trust and gain deep insight" / "Freely upload PDFs, notes and URLs." with the CTA "New collection".
  - "Your library is empty" / "Upload or drop a file here to add to your library."
  - "You have no history yet". "There are no contents".
- **Collections:**
  - item meta: "{{n}} sources · {{n}} members · Uploaded by · Date uploaded"
  - actions: "Add source" (Add link, Add text, upload) and "Search this collection"
  - sharing dialog: "People with access", "Grant access"
  - the drop zone line "Drag & drop files to upload sources" and a supported-files hint
- **History filters:** tabs "All / AI Answers / Highlights" and a "Starred" view ("Saved to Starred" / "Removed from Starred" toasts).

### 3.15 Onboarding [i18n, inferred]

- **Sign-up funnel:**
  - "What do you want to do?"
  - profession chips ("PhD / postdoc", "Professor / faculty", "Medical student / professional")
  - "Select or enter your research field"
  - a welcome offer ("Welcome Gift for {{name}}!")
  - an annual-plan nudge
- **Feature education:** **Lottie** demo loops at 16:9 or 4:3 inside dialogs ("How Literature Review works"), plus coachmarks ("Invite friends anytime").
- **Login benefit lines** pair a headline with a reassurance, for example "No model training. Your ideas never become someone else's answers."

### 3.16 Mobile [exact]

- **Under 1024px:** no sidebar; a hamburger opens the drawer; the main sheet is full-bleed (no rounded corners); header padding is 12/20.
- **Under 600px:** composer radius 20px; page padding 20px; dialog actions stack; source lists open in bottom drawers; `env(safe-area-inset-bottom)` is respected for the docked composer.
- **Native apps** (iOS, Android, Mac, Windows) and browser extensions exist. Reviews call mobile "functional but not flagship".

---

## 4. Interaction and microcopy patterns that make it feel fast and friendly

1. **One obvious place to start.** Every product opens on a hero question and a single pill composer. Mode, model and attachments are folded into the composer instead of being separate screens.
2. **Narrated progress instead of spinners.** Agent steps are shown with live, shimmering verbs ("Searching…", "Reading…", "Checking the facts...") that settle into past tense with counts ("Found 24 web pages"). Elapsed time is visible, and there is an escape hatch ("Get answer now").
3. **Optimistic and non-blocking work.** Long work moves to a new tab or into the background ("Answer is being prepared in a new tab…"). Uploads show counts ("3/5 file(s) uploaded").
4. **Quiet hover and crisp focus.** Hover is a gray 8% wash and nothing else: no lift, no border change, 100ms. Focus is a 1px colored outline for buttons, or a brand border with a 4px faint halo for text fields. Hover is disabled on touch devices.
5. **Keyboard everywhere, and visible.** "New question ⌘K" shows keycaps right in the sidebar row and in tooltips. Enter sends, Shift+Enter adds a newline, "/" opens skills, Esc closes.
6. **Contextual next steps.**
   - After attaching: "Summarize this file" / "Explain this image".
   - After an answer: "Make It Detailed" / "Make It Simple" and follow-up questions.
   - An intent nudge when another tool fits better ("… might handle this one better" with "Run …").
7. **Transparent costs.** Models are labeled "Credits needed" or "No credits needed". Credit renewals are explained ("{{n}} free credits to be recharged in {{hh:mm}}. Unused credits don't roll over.").
8. **Short, human copy.**
   - Toasts are 2–4 words in past tense ("Link copied", "Deleted").
   - Errors say what happened and what to do ("File upload failed. Please try again.", "Something went wrong. Try again soon.").
   - Confirmations are questions with the consequence underneath.
   - Personalization is used sparingly ("Looking for facts, {{name}}?").
   - Placeholders double as instructions and include an example ("(e.g., …)").
9. **Trust signals inline.** Every claim links to a source. Dotted underlines mark citations. "Reliable Sources" labels appear. Unreadable files are flagged ("AI agent cannot read this file/link.").
10. **Starring and favorites over folders.** "Starred" exists for models, threads and items, which gives quick personal curation with minimal management UI.

---

## 5. Fuobe adaptation

### 5.1 Principles

1. **Neutral chrome, colorful content.** Generated images and videos are the color. The UI stays zinc-gray, and the accent appears only on the primary action, focus, selection and progress.
2. **Frame and sheet.** Keep Liner's tinted frame with an inset rounded sheet. In the gallery and lightbox the sheet can go darker for media.
3. **The composer is the product.** It is a pill prompt box that is centered on empty pages and **docked to the bottom center** once results exist. Model, ratio, count, duration and references are chips inside it.
4. **Narrate generation.** Queue, generating, upscaling and done are shown on the result tile itself, with shimmer text and a progress percentage. The user is never blocked and can keep prompting while jobs run.
5. **Serif for moments, sans for work.** Use the display serif for the hero, page titles, empty states and the prompt echo on result groups; use the sans everywhere else.

### 5.2 Proposed theme: `src/app/globals.css` (Tailwind v4 / shadcn, oklch)

This is a drop-in replacement for the `:root`, `.dark`, `@theme inline` and `@layer base` blocks of the current file. It keeps the existing imports and `@custom-variant dark`, and the repo uses `next-themes` with `attribute="class"`.

- **Neutrals** are Liner's gray-cool ramp (effectively zinc).
- **The accent is new: "Fuobe Iris"**, a deep blue-violet. Its light-mode value is `oklch(0.52 0.21 282)`, about `#5d4bdb`, which gives white text a 6.0:1 contrast ratio.
- **The secondary highlight is "Spark" amber**, `oklch(0.88 0.16 95)`, about `#f9d544`. It plays the role of Liner's lime highlighter: credits, "New" badges, favorites and text highlight.
- **Departures from Liner, for accessibility and media:**
  - `--muted-foreground` is one step darker (`#6e6e71`, 5.1:1) than Liner's secondary label (`#818184`, 3.9:1, which fails AA).
  - Dark mode goes one step deeper (`#121213` canvas) so images pop.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem; /* 10px = Liner radius-medium. With the multipliers below: sm 6, md 8, lg 10, xl 14 */

  /* Surfaces. Canvas sheet is white; the frame (sidebar) is one tint darker */
  --background: oklch(1 0 0);                       /* #ffffff */
  --foreground: oklch(0.235 0.002 286);             /* #1e1e1f */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.235 0.002 286);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.235 0.002 286);

  /* Brand: Fuobe Iris */
  --primary: oklch(0.52 0.21 282);                  /* #5d4bdb, white text 6.0:1 */
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.958 0.001 286);              /* #f1f1f2, subtle buttons and chips */
  --secondary-foreground: oklch(0.235 0.002 286);
  --muted: oklch(0.958 0.001 286);                  /* #f1f1f2 */
  --muted-foreground: oklch(0.539 0.005 286);       /* #6e6e71, 5.1:1 on white */
  --accent: oklch(0.667 0.004 286 / 8%);            /* translucent hover wash (Liner alpha-gray-8) */
  --accent-foreground: oklch(0.235 0.002 286);
  --destructive: oklch(0.577 0.215 27);             /* #dc2627 */
  --border: oklch(0.931 0.001 286);                 /* #e8e8e9 */
  --input: oklch(0.92 0.003 286);                   /* #e4e4e6 */
  --ring: oklch(0.62 0.17 282);                     /* components apply ring/50 → soft iris halo */

  /* Charts: iris, teal, amber, rose, sky */
  --chart-1: oklch(0.52 0.21 282);
  --chart-2: oklch(0.70 0.115 195);
  --chart-3: oklch(0.80 0.15 80);
  --chart-4: oklch(0.66 0.21 8);
  --chart-5: oklch(0.66 0.15 240);

  /* Sidebar = app frame */
  --sidebar: oklch(0.985 0.001 286);                /* #fafafb */
  --sidebar-foreground: oklch(0.235 0.002 286);
  --sidebar-primary: oklch(0.52 0.21 282);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.958 0.001 286);         /* active row #f1f1f2 */
  --sidebar-accent-foreground: oklch(0.235 0.002 286);
  --sidebar-border: oklch(0.931 0.001 286);
  --sidebar-ring: oklch(0.62 0.17 282);

  /* Fuobe extensions (Liner-inspired semantic roles) */
  --brand-text: oklch(0.47 0.20 282);               /* #513dc5, brand-colored text and links */
  --brand-faint: oklch(0.52 0.21 282 / 8%);         /* selected chip / tile fill */
  --brand-faint-hover: oklch(0.52 0.21 282 / 12%);
  --highlight: oklch(0.88 0.16 95);                 /* Spark #f9d544: credits, "New", favorites */
  --highlight-foreground: oklch(0.30 0.06 85);      /* #3c2b02 */
  --subtle-foreground: oklch(0.799 0.004 286);      /* #bdbdc0 placeholders, disabled, tertiary */
  --border-strong: oklch(0.667 0.004 286 / 48%);
  --success: oklch(0.56 0.13 147);
  --warning: oklch(0.62 0.15 60);
  --overlay: oklch(0 0 0 / 48%);
  --tooltip: oklch(0.345 0.003 286);                /* #39393b inverse chip, both themes */
  --tooltip-foreground: oklch(1 0 0);
  --media: oklch(0.183 0.002 286);                  /* lightbox / video letterbox, always dark */

  --elevation-soft: 0 4px 12px oklch(0 0 0 / 5%);
  --elevation-normal: 0 0 1px oklch(0 0 0 / 6%), 0 1px 8px oklch(0 0 0 / 6%), 0 2px 12px oklch(0 0 0 / 8%);
  --elevation-strong: 0 6px 16px oklch(0 0 0 / 12%), 0 4px 12px oklch(0 0 0 / 8%), 0 0 8px oklch(0 0 0 / 8%);
  --elevation-heavy: 0 16px 20px oklch(0 0 0 / 12%), 0 8px 16px oklch(0 0 0 / 8%), 0 0 8px oklch(0 0 0 / 8%);
}

.dark {
  --background: oklch(0.183 0.002 286);             /* #121213 canvas (deeper than Liner's #1e1e1f) */
  --foreground: oklch(0.985 0.001 286);             /* #fafafb */
  --card: oklch(0.235 0.002 286);                   /* #1e1e1f */
  --card-foreground: oklch(0.985 0.001 286);
  --popover: oklch(0.265 0.004 286);                /* #252527 */
  --popover-foreground: oklch(0.985 0.001 286);

  --primary: oklch(0.57 0.20 282);                  /* #6a5ee7, white text 4.8:1 */
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.29 0.004 286);               /* #2b2b2d */
  --secondary-foreground: oklch(0.985 0.001 286);
  --muted: oklch(0.29 0.004 286);
  --muted-foreground: oklch(0.735 0.003 286);       /* #a9a9ab, 8:1 on canvas */
  --accent: oklch(1 0 0 / 7%);                      /* white-alpha hover wash */
  --accent-foreground: oklch(0.985 0.001 286);
  --destructive: oklch(0.68 0.20 25);               /* #fc5855 */
  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.66 0.15 282);

  --chart-1: oklch(0.66 0.15 282);
  --chart-2: oklch(0.75 0.12 195);
  --chart-3: oklch(0.84 0.15 85);
  --chart-4: oklch(0.72 0.18 8);
  --chart-5: oklch(0.72 0.13 240);

  --sidebar: oklch(0.21 0.003 286);                 /* #18181a frame, a touch lighter than the canvas */
  --sidebar-foreground: oklch(0.985 0.001 286);
  --sidebar-primary: oklch(0.57 0.20 282);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(1 0 0 / 8%);
  --sidebar-accent-foreground: oklch(0.985 0.001 286);
  --sidebar-border: oklch(1 0 0 / 8%);
  --sidebar-ring: oklch(0.66 0.15 282);

  --brand-text: oklch(0.74 0.13 282);               /* #9ea0fa */
  --brand-faint: oklch(0.57 0.20 282 / 14%);
  --brand-faint-hover: oklch(0.57 0.20 282 / 20%);
  --highlight: oklch(0.85 0.15 95);
  --highlight-foreground: oklch(0.30 0.06 85);
  --subtle-foreground: oklch(0.476 0.005 286);      /* #5c5c5f */
  --border-strong: oklch(1 0 0 / 24%);
  --success: oklch(0.72 0.16 147);
  --warning: oklch(0.75 0.16 60);
  --overlay: oklch(0 0 0 / 64%);
  --tooltip: oklch(0.345 0.003 286);
  --tooltip-foreground: oklch(1 0 0);
  --media: oklch(0.122 0 0);

  --elevation-soft: 0 6px 12px oklch(0 0 0 / 20%);
  --elevation-normal: 0 0 1px oklch(0 0 0 / 22%), 0 1px 8px oklch(0 0 0 / 22%), 0 2px 16px oklch(0 0 0 / 26%);
  --elevation-strong: 0 6px 16px oklch(0 0 0 / 36%), 0 4px 12px oklch(0 0 0 / 24%), 0 0 8px oklch(0 0 0 / 24%);
  --elevation-heavy: 0 16px 20px oklch(0 0 0 / 36%), 0 8px 16px oklch(0 0 0 / 24%), 0 0 8px oklch(0 0 0 / 24%);
}

@theme inline {
  /* Fonts: variables come from next/font (see 5.3) */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-heading: var(--font-instrument-serif), ui-serif, Georgia, serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;

  /* shadcn color mapping */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  /* Fuobe extensions → bg-brand-faint, text-brand-text, bg-highlight, bg-overlay, text-subtle-foreground… */
  --color-brand-text: var(--brand-text);
  --color-brand-faint: var(--brand-faint);
  --color-brand-faint-hover: var(--brand-faint-hover);
  --color-highlight: var(--highlight);
  --color-highlight-foreground: var(--highlight-foreground);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-border-strong: var(--border-strong);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-overlay: var(--overlay);
  --color-tooltip: var(--tooltip);
  --color-tooltip-foreground: var(--tooltip-foreground);
  --color-media: var(--media);

  /* Radius: keep the repo's multipliers. With --radius 10px: sm 6, md 8, lg 10, xl 14, 2xl 18, 3xl 22, 4xl 26 */
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
  --radius-sheet: 0.75rem;     /* 12px: inset sheet corners, dialogs, result tiles */
  --radius-composer: 1.75rem;  /* 28px: pill composer (use rounded-[20px] below sm) */

  /* Elevation → shadow-soft / shadow-normal / shadow-strong / shadow-heavy */
  --shadow-soft: var(--elevation-soft);
  --shadow-normal: var(--elevation-normal);
  --shadow-strong: var(--elevation-strong);
  --shadow-heavy: var(--elevation-heavy);

  /* Type extras → text-caption (13px sidebar rows), text-body (15px reading), text-display (34px hero) */
  --text-caption: 0.8125rem;
  --text-caption--line-height: 1.3;
  --text-body: 0.9375rem;
  --text-body--line-height: 1.7;
  --text-display: 2.125rem;
  --text-display--line-height: 1.15;

  /* Motion (Liner primitives) → ease-enter / ease-exit / ease-move */
  --ease-enter: cubic-bezier(0.08, 0.82, 0.17, 1);
  --ease-exit: cubic-bezier(0.3, 0, 1, 1);
  --ease-move: cubic-bezier(0.36, 0, 0.12, 1);
  --default-transition-duration: 100ms;
  --default-transition-timing-function: cubic-bezier(0.36, 0, 0.12, 1);

  --animate-shimmer-text: shimmer-text 2.5s ease-in-out infinite;
  --animate-skeleton: skeleton-sweep 1.4s ease-in-out infinite;
  --animate-fade-up: fade-up 200ms cubic-bezier(0.08, 0.82, 0.17, 1) both;
  --animate-pop-in: pop-in 120ms ease-out both;
  --animate-caret: caret-blink 1s step-end infinite;

  @keyframes shimmer-text {
    from { mask-position: 100% 0; }
    to   { mask-position: 0 0; }
  }
  @keyframes skeleton-sweep {
    from { background-position: 200% 0; }
    to   { background-position: -200% 0; }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pop-in {
    from { opacity: 0; transform: scale(0.95); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes caret-blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    @apply font-sans;
  }
  body {
    /* the frame color; the inset <main> sheet uses bg-background */
    @apply bg-sidebar text-foreground antialiased;
    font-feature-settings: "cv11", "ss01"; /* Inter: single-storey a, open digits; optional */
  }
  h1, h2, h3, .font-heading {
    letter-spacing: -0.01em; /* Liner uses -0.03em on Flare; Instrument Serif is already tight */
  }
  button:not(:disabled), [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}

@layer utilities {
  /* "Generating…" label: <span class="shimmer-text animate-shimmer-text">Generating…</span> */
  .shimmer-text {
    mask-image: linear-gradient(90deg, #000 30%, #0004 50%, #000 70%);
    mask-size: 250% 100%;
  }
  .skeleton-sweep {
    background-image: linear-gradient(90deg, transparent, oklch(1 0 0 / 50%) 50%, transparent);
    background-size: 200% 100%;
    background-repeat: no-repeat;
  }
  .dark .skeleton-sweep {
    background-image: linear-gradient(90deg, transparent, oklch(1 0 0 / 6%) 50%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .animate-shimmer-text, .animate-skeleton { animation: none; }
  }
}
```

**Notes:**

- `--accent` is translucent on purpose. It reproduces Liner's "wash" hover on any surface: sidebar, sheet, popover or image overlays. If a third-party component needs an opaque accent, use `bg-secondary` there.
- Focus: shadcn's default `focus-visible:ring-[3px] ring-ring/50` gives a soft iris halo. For the composer, add `focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint` to match Liner's brand border with a 4px faint halo. For dense toolbars, a crisp `focus-visible:outline-1 outline-ring` is closer to Liner.
- Dark mode should be the **default for generation and gallery pages**: creative studios read better dark. Set `defaultTheme="system"` with a quick toggle in the profile menu ("Dark mode / Light mode / System setting", Liner's labels). The lightbox always uses `bg-media`.

### 5.3 Fonts (Google Fonts via `next/font/google`)

| Role | Font | Why |
|---|---|---|
| UI / body (`--font-sans`) | **Inter** (variable) | Liner's Pretendard is Inter-derived in Latin, so this is the closest free match for the 13/14/15/16px UI rhythm. Geist (already in the repo) is an acceptable alternative with a slightly more technical feel. |
| Display (`--font-heading`) | **Instrument Serif** (400, plus italic) | A contemporary display serif. Like Liner's Flare titles, it is used only at weight 400, for the hero, page titles, empty states and prompt echoes. It gives the "editorial and warm" moments without licensing Flare. Alternative: **Fraunces** (variable `opsz`/`SOFT`) if a wider face is wanted. |
| Mono (`--font-mono`) | **Geist Mono** (already in the repo) | Seeds, dimensions, credit costs, keycaps. |

```tsx
// src/app/layout.tsx (fonts only)
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"], weight: "400", style: ["normal", "italic"],
  variable: "--font-instrument-serif", display: "swap",
});
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// <html className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}>
```

**Type scale to use** (from Liner):

| Size | Line height | Use |
|---|---|---|
| 11–12px | 1.3 | Meta, badges |
| **13px** | 1.3 | Sidebar rows, chips (`text-caption`) |
| **14px** | | Default UI (`text-sm`) |
| 15px | 1.7 | Reading text in details panels (`text-body`) |
| **16px** | 1.6 | Prompt editor (`text-base`) |
| 22px | | Serif page titles (`font-heading text-[22px]`) |
| **34px** | | Serif hero (`font-heading text-display`) |
| 40–54px | | Marketing |

Weights: 400 for body, 500 for labels and buttons, 600 for emphasis and the active nav row.

### 5.4 Pattern mapping: Liner to shadcn to Fuobe

| Liner pattern | shadcn/ui building blocks | Fuobe usage |
|---|---|---|
| Frame and inset sheet | `SidebarProvider`, `Sidebar variant="inset" collapsible="icon"`, `SidebarInset` | App shell for every page |
| 48px rail / 260px panel, click-rail-to-expand, ⌘K keycaps | `SidebarRail`, `SidebarMenuButton`, `Kbd`, `Tooltip` | Nav: New, Image, Video, Edit, Upscale, Library, Favorites, Collections, History |
| Hero question and pill composer | Custom `PromptComposer` (textarea auto-grow), `Button size="icon"`, `DropdownMenu`, `Popover`, `ToggleGroup` | Empty state of `/image` and `/video`, centered at 26vh |
| Composer docked at the bottom of a thread | Same component, `sticky bottom-0` with a gradient fade mask | Generation pages once results exist |
| Model picker dialog (search, Starred, "Credits needed") | `Dialog` with `Command` (cmdk), `Tabs`, `Badge` | Model chip in the composer, image or video models with per-run credit cost |
| Segmented control with sliding thumb | `ToggleGroup` / `Tabs` (track variant) | Count (1/2/4), duration (5s/10s), quality |
| Underline tabs | `Tabs` (underline variant) | Library filters: All / Images / Videos / Favorites |
| Chips, keycaps, badges | `Badge`, `Toggle`, `Kbd` | Ratio "16:9", style presets, "New", credits |
| Agent step list with shimmer | `Collapsible`, custom `Shimmer`, `Spinner`, `Progress` | Per-batch status: Queued → Generating 42% → Upscaling → Done |
| Answer action row and refine chips | `Button variant="ghost" size="icon-sm"`, `Tooltip` | Tile actions: Download, Favorite, Upscale, Animate, Use as reference, Remix |
| Follow-ups | `Button variant="secondary"` chips | "Try variations": More dramatic lighting, Wider shot, Make it a video |
| Library banner and empty state | `Card` (tinted), illustration slot, `Button` | First-run Library: "Everything you make lands here" |
| Dialog (400px, equal-width actions, stack on mobile) | `Dialog` / `AlertDialog` / responsive `Drawer` | Delete, rename, share, settings |
| Toasts (top-center) | `Sonner` | "Saved to Favorites", "Link copied", "Generation failed. Credits refunded." |
| Drop overlay ("Upload to thread") | Custom overlay with `bg-overlay`, dashed `border-primary` | "Drop images to use as references" |
| Intent nudge | `Popover` anchored to the composer | Image page plus "camera pan / animate" in the prompt suggests "Video might handle this one better" with "Switch to Video" |

### 5.5 Page blueprints

**Shell:**

```
┌ frame (bg-sidebar) ──────────────────────────────────────────────────────────┐
│┌ sidebar 260 ─────────┐╭ sheet (bg-background, rounded-l-[12px]) ──────────╮│
││ ◼ Fuobe          «   ││ header 64px: Image ▸ Untitled session   [Share][⋯] ││
││ ✎ New        ⌘ K     ││                                                    ││
││                      ││                                                    ││
││ CREATE               ││          (gallery or empty state)                  ││
││ ▣ Image   (active)   ││                                                    ││
││ ▶ Video              ││                                                    ││
││ ✧ Edit               ││                                                    ││
││ ⤢ Upscale            ││                                                    ││
││                      ││                                                    ││
││ LIBRARY              ││                                                    ││
││ ▤ All assets         ││     ╭──────────────────────────────────────╮       ││
││ ☆ Favorites          ││     │ composer (docked, max-w-[760px])      │       ││
││ ▢ Collections        ││     ╰──────────────────────────────────────╯       ││
││                      │╰────────────────────────────────────────────────────╯│
││ RECENT  (history)    │                                                      │
││ neon koi in rain…    │                                                      │
││ ──────────────────── │                                                      │
││ ✦ 1,240 credits  [+] │                                                      │
││ (◯) Ada L.       ⌄ ⚙ │                                                      │
│└──────────────────────┘                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Sidebar section labels:** 11–12px uppercase or sentence case in `text-muted-foreground`, `px-2`.
- **Rows:** 32px, 13px.
- **Active row:** `bg-sidebar-accent` with `font-semibold`. No colored bar. This is the quiet active state Liner uses.
- **"Recent" history list:** prompt snippets truncated, with a hover "⋯" menu (Rename, Star, Delete).
- **Credits pill:** `bg-highlight/20 text-highlight-foreground`, with a coin icon and a mono number.
- **Footer:** profile button (24px avatar, name, chevron) and a settings icon. Fuobe is open source, so a "GitHub" or "Docs" ghost link can replace Liner's product switcher.

**Generation page, empty state (`/image`):**

```
                         (pt-[26vh])
                What should we make today?          ← font-heading text-display, centered
                         (gap-10 = 40px)
   ╭──────────────────────────────────────────────────────────────────╮
   │ (+)  Describe an image… try "a koi pond at night, neon rain"     │
   │      [◇ Flux Pro ⌄] [▭ 1:1 ⌄] [×4 ⌄] [✧ Enhance]   ≈ 8 cr  (↑)    │
   ╰──────────────────────────────────────────────────────────────────╯
     [🖼 Product shot] [🖼 Anime portrait] [🖼 Isometric room] [🖼 Logo]   ← starter chips, gap-2
```

**Generation page with results** (newest batch at the bottom, like a thread; or newest at the top, see the note below):

```
  ┌ batch header ──────────────────────────────────────────────────────┐
  │ "a koi pond at night, neon rain"   ← font-heading 20–22px (prompt echo, like Liner's serif question)
  │ Flux Pro · 1:1 · 4 images · 2 min ago      [↻ Reuse] [⇄ Remix] [⋯] │ ← 13px muted meta + ghost buttons
  ├────────────┬────────────┬────────────┬────────────┐
  │  tile      │  tile      │ ░░░░░░░░░░ │ ░░░░░░░░░░ │ ← skeleton-sweep while generating
  │            │            │ Generating…│ Queued     │   shimmer-text label + % in mono
  └────────────┴────────────┴────────────┴────────────┘
             … more batches …
   ╭─────────────────────── docked composer (sticky bottom-4) ──────────╮
   ╰────────────────────────────────────────────────────────────────────╯
```

- **Tiles:** `rounded-[12px] overflow-hidden bg-muted`. Grid `gap-2` (8px), 2–4 columns by breakpoint, preserving each image's aspect ratio. Use a masonry layout for mixed ratios.
- **Tile hover** (`@media (hover:hover)` only): a bottom gradient `from-black/50` fades in over 100ms with a ghost icon-button row in white (Download, Favorite, Upscale, Animate, Use as reference, ⋯). There is no lift or scale on hover, staying with Liner's restraint. A 1px `ring-primary` marks a selected tile.
- **Finished tiles** use `animate-fade-up`. Failed tiles show the muted message "Couldn't generate this one" with a "Retry" button, and a toast reports the credit refund.
- **Lightbox:** a full-screen `Dialog` on `bg-media`, with the image centered and contained. A right-hand 320px details panel (`bg-card`) shows the prompt (serif), model, seed (mono, copy button), size and duration, plus actions. Keyboard: ←/→ navigate, Esc closes, F favorites, D downloads, R reuses the prompt. Show these as keycaps in tooltips.
- **Ordering:** Liner's chat model puts the newest item at the bottom, next to the composer. For a gallery, **newest on top with the composer docked at the bottom** also works if each new batch scrolls into view. Pick one and keep it consistent across the image and video pages.

**Library (`/library`):**

- A serif title, "Library".
- Underline `Tabs`: All / Images / Videos / Favorites.
- A right-aligned search input (32px) and a "New collection" outline button.
- A grid of assets as above.
- **First-run banner card:** `bg-brand-faint border border-primary/10 rounded-lg`, with the copy "Everything you make lands here" / "Star favorites, group them into collections, and drop in references." and an illustration on the right.
- **Empty search:** "No matches for '{{query}}'" with a "Clear search" button.
- **Collections:** cards with a 2×2 thumbnail mosaic, title, and "{{n}} items · Updated {{time}}".

**Video page:** the same composer, with additional controls:

- Start-frame and end-frame reference slots, shown as two 48px dashed tiles inside the composer's attachment row.
- A duration segmented control (5s / 10s).
- A camera-motion chip.
- Tiles show a poster frame plus a duration badge (`bg-black/60 text-white text-[11px] rounded-[4px] px-1`). They autoplay muted on hover. Generating tiles show "Rendering frames… 37%".

### 5.6 Composer spec for Fuobe

```
╭─ rounded-composer (28px; 20px < sm) · bg-background · border border-border · shadow-soft · p-2.5 ─╮
│ [ref 48×48 ×] [ref 48×48 ×]                     ← attachment row, only when present, gap-2      │
│ (+)  textarea 16px/1.6, auto-grow 1→8 lines, placeholder text-subtle-foreground       (🎙)/(↑) │
│      [model ⌄] [ratio ⌄] [count ⌄] [duration ⌄] [✧ Enhance]          "≈ 8 credits"   (send)   │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

- **"+"** is a 40px round `variant="outline"` icon button with a muted icon. Its menu holds: Upload image, Choose from Library, Paste URL; and for video, Start frame / End frame.
- **Chips** are 32px tall, `rounded-full`, `bg-secondary hover:bg-accent`, 13px, with a 16px leading icon and a trailing chevron. Each opens a `Popover`:
  - Ratio: a grid of ratio tiles, each a scaled rectangle with its label.
  - Count: a segmented control.
  - Model: a `Dialog` with a `Command` search, "Starred" at the top, and a cost badge on every row.
- **Send** is a 40px round `bg-primary` icon button with an up arrow. It is disabled (gray) while the prompt is empty. While jobs are running it keeps working (queuing more). A separate "Stop" button appears on running batches, not in the composer.
- **Cost hint:** `text-caption text-muted-foreground font-mono`, placed left of send. The hint updates live as chips change, following Liner's credit transparency.
- **Keys:** ⌘/Ctrl+Enter or Enter generates. Shift+Enter adds a newline. "/" opens presets ("/cinematic", "/product"). ⌘K starts a new session. ⌘U uploads a reference. Esc blurs. Show all of these in tooltips.
- **Focus:** `focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint`.
- **Drag and drop** anywhere shows a full-sheet overlay (`bg-overlay`) with a dashed `border-primary` card reading "Drop to use as reference".
- **Placeholders teach**, with examples:
  - Image: "Describe an image… try 'a koi pond at night, neon rain'"
  - Video: "Describe a shot… e.g., 'slow dolly-in on a rainy street'"
  - Edit: "Describe the change… e.g., 'replace the sky with a sunset'"
- **Post-result refine chips** ("Try variations") render above the docked composer: "More dramatic lighting", "Wider shot", "Different style", "Make it a video".

### 5.7 Fuobe microcopy, following Liner's voice

| Moment | Liner | Fuobe |
|---|---|---|
| Hero | "Looking for facts?" / "Looking for facts, {{name}}?" | "What should we make today?" / "Ready when you are, {{name}}" |
| Composer | "Ask anything or type / for skills" | "Describe an image, or type / for presets" |
| Progress | "Thinking…", "Searching web pages", "Reading…" → "Read" | "Queued", "Generating… 42%", "Upscaling…" → "Done in 38s" |
| Background | "Answer is being prepared in a new tab…" | "Still rendering. Keep going, we'll drop it in when it's ready." |
| Toasts | "Copied", "Link copied", "Saved to Starred" | "Prompt copied", "Link copied", "Saved to Favorites", "Added to Collection" |
| Errors | "File upload failed. Please try again." | "Generation failed. Credits refunded." with Retry, and "That file's over 25 MB. Try a smaller one." |
| Empty | "Your library is empty" / "Upload or drop a file here…" | "Nothing here yet" / "Generate something or drop images to start a collection." |
| Confirm | "Delete highlight?" / "Deleted source cannot be recovered" | "Delete 4 images?" / "They'll be removed from your Library and can't be recovered." |
| Costs | "Credits needed" / "No credits needed" | "≈ 8 credits" / "Free" badges in the model picker |
| Nudge | "Literature Review might handle this one better" | "Video might handle this one better" with "Switch to Video" |

### 5.8 Motion spec for Fuobe

| Interaction | Duration and easing | Implementation |
|---|---|---|
| Hover wash | 100ms, `--ease-move` | Default transition |
| Menus and popovers open | 120ms, `animate-pop-in` | Radix and tw-animate-css already do zoom-95 and fade; set `duration-[120ms]` |
| Dialog | Overlay fade 150ms; card fade plus translateY(8px), about 200–260ms, `--ease-enter` | |
| Sidebar collapse | Width 150ms; labels fade | |
| Segmented and tab indicator | About 376ms spring (or `--ease-move` 250ms) | |
| Result tiles | `animate-fade-up` (200ms, 4px) on completion; `skeleton-sweep` 1.4s while pending; `shimmer-text` 2.5s on status labels | |
| Toasts | Sonner defaults, top-center | |
| Reduced motion | Disable shimmer and sweep; keep opacity fades | |

### 5.9 What to emulate and what not to copy

**Emulate:**

- frame and inset-sheet layout
- 48/260 rail
- pill composer with chips
- narrated progress
- translucent hover washes
- 1px crisp focus
- 24/32/40/48 control rhythm
- 6/8/10/12 radii
- soft layered shadows
- serif-for-moments typography
- top-center short toasts
- keycaps in UI
- credit transparency
- intent nudges
- two-line empty states

**Do not copy:**

- Liner's logo or mark
- the green/olive/teal brand ramps
- ABC Arizona Flare (commercial) or Pretendard JP specifics
- illustrations, Lottie files and the dotted-citation motif
- exact marketing or UI copy
- product names ("Source collection", "Scholar")

---

## 6. Sources

**Primary (fetched 2026-10-16):**

- https://liner.app redirects (302) to https://www.fortune.domains/name/Liner.app, a domain-sale listing (403 to fetchers)
- https://getliner.com: 410 Gone
- https://liner.com/ (marketing home and embedded i18n dictionary)
- https://liner.com/search, https://liner.com/scholar, https://liner.com/write
- https://app.liner.com/ (Search app shell)
- https://app.liner.com/workspace/collections (Library page shell)
- https://scholar.liner.com/ and https://write.liner.com/ (sidebar variants)

**CSS bundles (tokens and components):**

- https://static.liner.com/_next/static/chunks/0mwxnc~9e-nj9.css
- https://static.liner.com/_next/static/chunks/016ig9i0l9ne5.css
- https://static.liner.com/_next/static/chunks/0sfsojte~97u3.css
- https://static.liner.com/_next/static/chunks/0zugcg72qhc~p.css
- https://static.liner.com/_next/static/chunks/09zvisxu1noaj.css
- https://static.liner.com/_next/static/chunks/126t-ppc68263.css
- https://liner.com/_next/static/css/6c495c79df712e66.css
- https://liner.com/_next/static/css/0a6d33d4933005ab.css
- https://liner.com/_next/static/css/2216903e6fb2dcdf.css

**Font CSS:**

- https://assets.liner.com/fonts/arizona-flare/ABCArizonaFlare.css
- https://assets.liner.com/fonts/elice-dx-neolli/EliceDXNeolli.css
- https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css
- Google Fonts "Charis SIL"

**JS:**

- The 78 chunks referenced by https://app.liner.com/ under https://static.liner.com/_next/static/chunks/ (Sonner config, libraries, intent-nudge keyword set)

**Secondary:**

- Rebrand: https://liner.com/learn/rebranding and https://www.venturesquare.net/en/975834/
- Deep Research guide: https://liner.com/en/learn/guide-deep-research
- Lenovo KB "Getting Started with Liner" (theme setting, models, uploads): https://liner.lenovocloudsoftware.com/portal/en/kb/articles/getting-started-with-liner-25-3-2026
- Reviews: https://aisotools.com/blog/liner-ai-review-2026 and https://www.aichatdaily.com/tools/liner
- App Store listing: https://apps.apple.com/app/id955395198
- Product Hunt (search result only): https://www.producthunt.com/posts/liner-browser-extension/reviews
- Domain history: https://domaininvesting.com/liner-acquires-liner-com/ and https://smartbranding.com/liner-secures-29-million-in-series-b-funding-upgrades-to-liner-com/

**Reference (format of the theme block):**

- shadcn/ui theming docs: https://ui.shadcn.com/docs/theming
- the repo's current `src/app/globals.css` (radius multipliers, `--font-heading`)
