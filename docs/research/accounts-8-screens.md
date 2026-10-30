# Fuobe research #8, part 2: every screen as a spec

_As of 2026-10-29. Companion to [`accounts-8.md`](accounts-8.md), whose § numbers this file cites. Each screen gives its route, who sees it, the layout at 1440 px and 390 px, the copy, empty, loading and error states, what each action does, and keyboard and screen-reader behaviour. Light and dark use only the existing tokens. The package that builds each screen is in brackets._

## S0. Conventions (every screen unless its spec says otherwise)

### S0.1 Layout and look

- shadcn/ui with Liner's feel (`liner-ui.md`): `font-heading` H1 (28 px in the auth card, 24 px on pages), 13 px muted lines, `h-7` pill chips, soft shadows, one primary action per screen.
- **Auth card:** a `min-h-svh` grid on `bg-sidebar`; the card is `max-w-sm rounded-2xl border bg-background p-7` (`p-6` under 400 px) with `shadow-soft`; 358 px wide at 390. A 44 px icon tile above the H1.
- **Settings pages:** H1, the sub-nav (S4.0), then `Section` blocks (`settings-form.tsx` L22–48): a 260 px label column on desktop, stacked on phone.
- **Wizard shell** (`/setup/*` after the first screen): `max-w-xl`, "Step N of M" from the step registry, a sticky bottom bar with Back and the primary button (safe-area padding).
- **Status colours** map to existing tokens only: Waiting and Pending → `muted` text with a `StatusDot`; Verified, Active, Paid → `success`; Lapsed, Past due, Blocked → `destructive`; Needs you, Low credits → the `highlight` token. Text on any status chip keeps 4.5:1 contrast in both themes (checked by the axe run in e2e). Charts use the validated data-viz palette with a light and dark pair; QR codes stay dark on white in both themes.

### S0.2 Phone (390 px) and ResponsiveDialog

- 16 px gutters; no sideways page scroll; chip rows and wide tables scroll inside their own container with edge fades (`useEdgeFade`, `library-view.tsx`); tables become card rows; 44 px tap targets.
- **`ResponsiveDialog`** (`src/components/ui/responsive-dialog.tsx`, acc-13): a centred Dialog at 600 px and wider; below 600 px a bottom sheet with `max-h-[85svh]`, `rounded-t-2xl`, a scrolling body, a sticky footer with `pb-[max(16px,env(safe-area-inset-bottom))]`, a visible Close button (aria-label "Close"), and stacked full-width buttons (primary on top). Menus and pickers use the same sheet under 600 px.
- **Destructive confirms** keep Radix `AlertDialog` (`role="alertdialog"`), styled as the same bottom sheet under 600 px; the body states the consequence; the destructive button is last on desktop and first on phone; Esc and Cancel close.

### S0.3 Who sees what (visibility matrix)

| Surface | Just me | Personal with sign-in | Studio member | Studio admin / owner | Studio auditor | Platform customer | Platform staff |
|---|---|---|---|---|---|---|---|
| Settings → General (engine, keys, ComfyUI, LoRAs, demo, StatusStrip) | ✓ | ✓ | — | ✓ | — | — | admin, owner |
| Settings → Models & licences | ✓ | ✓ | read-only card "Your admin manages models, keys and GPUs." | ✓ | — | — | admin, owner |
| Settings → Account | tokens and appearance only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Settings → Access | ✓ (owner) | ✓ | — | ✓ | — | — | owner |
| Settings → Usage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (credits) | ✓ |
| Settings → Plan & billing | — | — | — | — | — | ✓ | — |
| Settings → Data & privacy | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Settings → Backup | ✓ | ✓ | — | owner | — | — | owner |
| Settings → About | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sidebar footer status block (Cloud models, ComfyUI, Demo) | ✓ | ✓ | — | ✓ | — | — | admin, owner |
| Get started guide on Home | ✓ | ✓ | member welcome (S3.6) | ✓ | member welcome | welcome card (S8.3) | ✓ |
| `/admin` | — | — | — | ✓ | audit, usage, people (read) | — | per staff role |
| ⌘K: Account, Usage, Inbox, Switch workspace, Sign out | partial (no Sign out) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Non-admins land on Account when they open `/settings`. A route a person can't see answers 404.

### S0.4 Forms, states and accessibility

- Visible labels; `autocomplete` (`email`, `username webauthn`, `current-password`, `new-password`, `one-time-code`, `name`); `autoFocus` on the first field; Enter submits; show/hide password button with `aria-pressed`.
- Errors are `role="alert"`, linked with `aria-describedby`; focus moves to the first error.
- Loading: skeletons for lists and cards; the primary button shows a spinner and keeps its width.
- Generic copy: "Couldn't load this. Try again." with Retry; "Couldn't save. Try again."; "Can't reach Fuobe. Check your connection and try again."; "Too many tries. Try again in {n} min."
- Toasts are short and past tense ("Invite sent", "Role changed", "Limit updated", "Key added"). Status changes are announced through an `aria-live="polite"` region.
- Tables have captions and `aria-sort`; charts are `role="img"` with a summary and "Show as table".
- Values set by the environment show a lock icon and "Set by the server".

### S0.5 Words

"Personal" (your private space), "Teams" (shared spaces), "space" only as the umbrella word ("Saving to"). Team roles: Owner, Admin, Editor, Viewer. Install roles: Owner, Admin, Member, Auditor; Platform staff: Billing, Moderator, Support. A seat clamp shows as "Editor · view-only seat" with the tooltip "Your account has a view-only seat. Ask for a full seat to make things." Money: "≈ $12.40" for USD estimates, "12 credits" exact, "Up to 18 credits" for open-engine holds.

## S1. Setup [acc-14 unless marked]

### S1.1 `/setup` — the first screen

- **Who:** anyone, on a fresh install only (afterwards `/setup` redirects to `/login` or `/`).
- **Layout:** the auth card, a little wider (`max-w-md`). Fuobe logo tile, H1 "Welcome to Fuobe", line "How do you want to start?". Two stacked option buttons (full width, 72 px, icon left, title and one line):
  - **Just me on this computer** — Laptop icon — "No sign-in. Anyone who can open this address can use Fuobe, so keep it on your own computer or home network."
  - **Create your account** — UserPlus icon — "Sign in with a password from any device. Next, choose whether Fuobe is just for you, for your studio, or a public service."
  - Footer (13 px): "You can change this any time in Settings → Access. Nothing is lost when you do." and (acc-21) "Moving from another computer? Restore a backup".
- **The code.** Arriving through the printed link (`/setup#code=4821-0937`), the code is moved into memory and the fragment removed; nothing is shown. Otherwise, after a choice, an inline region opens under it: label "Setup code", hint "Shown in the terminal where Fuobe is running.", an 8-digit input shown as 4-4 (`one-time-code`, numeric, paste fills it), a "Where do I find it?" collapsible ("In the terminal where you ran pnpm start, in docker logs for a container, or in the file data/setup-code."), and the button (Just me: "Start using Fuobe"; account: "Continue").
- **Actions:** Just me → `POST /api/setup/finish {mode: "personal", signin: "off", code}` → full load of `/` with the toast "Fuobe is ready". Create your account → `POST /api/setup/code` (sets `fuobe_setup`, 2 h, Strict) → `/setup/start`.
- **Errors:** "That code doesn't match. Use the one in the terminal." (role=alert); after 5 misses "Too many tries. Try again in 5 s." (a countdown); 409 "Setup was already finished. Opening Fuobe…" then a full load.
- **Phone:** the same card, option buttons stacked; the code region pushes content down (no modal).
- **Keyboard:** Tab reaches both options; Enter or Space chooses; the code input gets focus when its region opens; Esc collapses it.

### S1.2 `/setup/start` — what will this Fuobe be?

- "Step 1". H1 "What will this Fuobe be?". A radio group of three cards (no buttons inside the cards):
  - **Just me, with sign-in** (Personal): "One person. You set everything up yourself." Bullets: "Your library, your keys, your GPU"; "Passkeys and two-step sign-in"; "Move to a studio or a public service later".
  - **My studio or team** (Studio): "Your company or studio uses Fuobe together." Bullets: "A private library for each person"; "Teams that share their work"; "Limits, company sign-in, audit log".
  - **A public service** (Platform): "Anyone can sign up and use Fuobe with a plan." Bullets: "Open sign-up"; "Plans, credits and payments"; "An admin panel for people, prices and safety". Until acc-57 this card is disabled with "Not ready in this version yet".
- Below the group, an `aria-live="polite"` region with the sticky primary "Continue" → `/setup/account?mode=…`. Arrow keys move between cards (Radix RadioGroup).

### S1.3 `/setup/account` — create the owner account

- H1 "Create your account". Fields: "Your name" (1–80); "Email" (required for Studio and Platform; Personal: "Email (optional)" with "For password reset codes and sign-in alerts, once email is set up. You never type it to sign in."); "Password" (`new-password`, hint "At least 8 characters. Longer is stronger." → at 15+ "Great, that's a strong password.").
- "Create account" → `POST /api/setup/account` (claim-owner intent; `owner@fuobe.invalid` internally when there is no email, never displayed). The email is **not** marked checked: once mail works (S1.8) a 6-digit code is sent and the review step shows "Check your email: we sent a code to {email}" with a code field; until it is checked, owner reset is only through `fuobe recover`.
- Errors: "Use at least 8 characters." / "That password is too common. Try a longer phrase." / "Enter an email like name@studio.com." / "Use 128 characters or fewer."

### S1.4 `/setup/address` (Personal)

- H1 "Where will you open Fuobe?". "Site address" prefilled with the current origin. Live checks (`src/lib/site-address.ts`, 300 ms debounce), each a 13 px line with an icon: a path or non-http scheme → error "Use an address like https://fuobe.example.com, with nothing after the name."; plain http to a non-local host → warning "Over plain http, your password can be read on the network. Use https if you open Fuobe from the internet."; `trycloudflare.com` → "Quick tunnel addresses change every time and drop live updates. Use a named tunnel instead."; https or localhost → "Passkeys will work at this address."
- "Finish" → `POST /api/setup/finish {mode: "personal", signin: "on", siteUrl}` → full load with "Fuobe is ready".

### S1.5 `/setup/studio` and `/setup/service`

- **Studio:** "Studio name" (default "Studio"), "Site address" (S1.4 checks), "Time zone" (Intl list, default the browser's; "Monthly spending limits reset on the 1st in this time zone."). A secondary button "Use recommended settings" fills every remaining step and jumps to Review: open sign-up limited to the owner's work domain when mail or Google is set up, otherwise approval; no email; email and password sign-in; two-step required for owner, admins and auditors with 7 days of grace; 30-day sessions; admins create teams, Listed; both key sources at $25 a month; fair GPU share.
- **Platform:** service name; site address (https unless localhost: "A public service needs https."); support email; legal name, address and country; DMCA agent (optional); Terms and Privacy URLs (empty uses Fuobe's templates); minimum age 18 (default) or 16.
- Each Continue saves `PUT /api/setup/draft`.

### S1.6 `/setup/join` — who can join (Studio and Platform)

- H1 "Who can join?". Radio: "Anyone can create an account" ("Open sign-up. Email addresses are checked."; preselected in both modes), "I approve new accounts", "Invite only", "Closed".
- "Only these email domains" chips (Studio: prefilled with the owner's work domain unless it is webmail; empty shows "Anyone who can reach {site} can join and spend up to the monthly limit on the studio's keys."). "People at these domains join without approval" (approval only; disabled without mail or Google: "Needs email or Google sign-in so we can check addresses. Until then, you approve each person."). "Block domains" (collapsible). "Check email addresses with a code" (forced on with open: "Required when anyone can sign up."). Platform: "Block throwaway email addresses" (on) and Turnstile keys with Test (acc-48).
- Without mail and without Google/OIDC, Open is disabled with "Open sign-up needs email or Google sign-in so we can check addresses." and the selection moves to "I approve new accounts" with a `role="status"` line saying so. The server refuses the same.

### S1.7 `/setup/keys` (Studio) and `/setup/allowance` (Platform core)

- **Who pays for runs?** Radio: "Both: people's own keys first, then the studio's within a monthly limit" (default); "The studio's keys, with a monthly limit per person"; "Everyone uses their own keys". "Monthly limit per person" $25 ("Applies to runs paid with the studio's keys."; 0 means no studio-paid runs). Optional studio keys (fal.ai, Replicate, Anthropic) with Save & test.
- **Platform allowance** (until acc-37/acc-40 replace it): "Free monthly allowance per person" $5.

### S1.8 `/setup/email`

- "Don't send email" (default in Studio), with what that means: "Invites are links you copy and send yourself"; "People who forget their password ask you for a reset link"; "Email addresses aren't checked, so open sign-up and domain auto-approve stay off unless Google sign-in is on".
- "Use my SMTP server": host, port (587), security (STARTTLS / SSL/TLS), user, password (encrypted), from name and address. "Send a test email" → "Sent. Check your inbox." or the SMTP error in plain words ("The server refused the password." / "Couldn't reach smtp.example.com on port 587."). A passing test is needed to continue with SMTP.
- Platform with open sign-up disables "Don't send email" ("A public service needs email for codes and receipts.").

### S1.9 `/setup/sign-in` — methods

Rows with switches: "Email and password" (can't be off unless another method is on); "Google" and "GitHub" (client id and secret, plus the read-only callback `<site>/api/identity/callback/<id>` with Copy); "Another provider (OpenID Connect)" (label, issuer, client id and secret, Check → "Found {issuer}. Sign-in will show 'Continue with {label}'." or "We couldn't read {issuer}/.well-known/openid-configuration. Check the issuer URL."; "Add another provider"); Passkeys (acc-19; disabled without https: "Passkeys need an https address."). In Studio, once acc-32 ships, "Another provider" shows "Company identity providers belong in Company sign-in." with a link. Saving bumps the identity config version.

### S1.10 `/setup/teams` and `/setup/invite`

- **Teams:** "Who can create teams": Only admins (Studio default) / Everyone (Platform default). Optional "Create your first team" (name, colour).
- **Invite** (Studio): an emails box that turns addresses into chips (invalid ones red with "Check this address."); role Member or Admin; first team (optional). Primary "Send invites" with mail, or "Create invite links" without: rows of email, link and Copy, "Expires in 72 hours". "Skip".

### S1.11 `/setup/review`

H1 "Ready to go". A description list of every choice with Edit links back to its step. Dependency errors appear in a red box at the top linking to the step to fix ("Open sign-up needs email or Google sign-in. Fix in Who can join."). "Finish setup" → writes the mode and `setup.state=done`, deletes the setup code, audits, full load (Studio: `/admin` Overview; Platform: `/admin` in Preview; Personal: `/`).

### S1.12 `/setup/restore` [acc-21]

"Restore a backup". Four copyable steps: "1 Stop Fuobe." "2 In the Fuobe folder, run: node bin/fuobe.mjs restore <backup file>" "3 Start Fuobe again." "4 Sign in with the account from the backup." Below, a status line polling sign-in options every 5 s: "Waiting for Fuobe to start again…" → "Restored. Opening Fuobe…".

## S2. Sign-in and recovery

### S2.1 `/login` [acc-11; Personal variant acc-1]

- **Studio and Platform:** install chip (name), H1 "Welcome back", "Sign in to {install name}.". Provider buttons first in the admin's order ("Continue with Google", "Continue with GitHub", "Continue with {label}"), the last-used one with a "Last used" pill (`fuobe:last-sign-in-method`); a divider "or"; Email (`username webauthn`), Password, "Forgot password?", primary "Sign in". Footer: open or approval → "New here? Create an account"; invite → "Need access? Ask {contact} for an invite."; closed → nothing. Company sign-in (acc-32) adds "Continue with company sign-in".
- **Personal with sign-in:** lock tile, H1 "Welcome back", "Sign in to {install name}.", one password field, "Sign in", "Forgot password?". With a passkey on this site (acc-19), "Sign in with a passkey" is the primary button and the password a secondary link.
- **Just me:** `/login` redirects to `/`.
- **Actions:** `POST /api/identity/sign-in/email {rememberMe: true}` (Personal: the `/api/auth/login` shim) → full load of `safeNext(next)`; `{twoStep: true}` → the code step (S2.2).
- **Errors:** "That email and password don't match." (Personal: "That password isn't right."); 423 "Too many wrong passwords. Sign in with a passkey, or reset your password." (Personal: "…or run fuobe recover on the computer where Fuobe runs."); unchecked email → `/verify?email=`; "That Google account isn't allowed here."; "Sign-in was cancelled."; registry codes per S2.7; `?reason=idle` → "You were signed out because you were away."; `?reason=expired` → "Your session ended. Sign in again."
- **Forgot password in Personal** (`/login?forgot=1`, in the card): with a checked owner email and mail, "Email me a code" → code, new password, "Set new password" → "Password changed. You've been signed out everywhere." with Sign in. Without: "On the computer where Fuobe runs, open a terminal in the Fuobe folder and run:" with the command box `node bin/fuobe.mjs recover` (Docker installs: `docker exec <container> node bin/fuobe.mjs recover`) and Copy, then "I have a code" → `/recover`.

### S2.2 The two-step step and `/two-step` [acc-19]

- **In the card** after `{twoStep: true}`: ShieldCheck tile, H1 "Enter your code", "Open your authenticator app and type the 6-digit code for {install name}." Code input (6 digits submit automatically). Checkbox "Don't ask again on this device for {n} days" (hidden when the policy is Never). "Verify". Links "Use a backup code instead" (format `xxxxx-xxxxx`) and "Start over".
- **Errors:** "That code isn't right. Check the time on your phone and try again." / "That code was already used. Wait for a new one." / "Too many wrong codes. Try again in 15 min, or use a backup code." / "This sign-in took too long. Enter your password again." After a backup code with 3 or fewer left: toast "{n} backup codes left. Make new ones in Settings → Account."
- **`/two-step?mode=session`:** the same card for a restricted `verify-2fa` session after Google, OIDC or company sign-in; posts to `/api/me/two-step/verify`; footer "Not you? Sign out".

### S2.3 `/register` [acc-11]

- H1 "Create your account", "Join {install name}." Providers ("Sign up with Google"), Name, Email, Password. Platform adds the consent block: an "Agree to all" row that expands to "Terms of Service (required)", "Privacy Policy (required)", "I'm {min age} or older (required)", "Product news by email (optional)", never pre-ticked; consents written through `recordConsent`; Turnstile (acc-48); a plan chip when arriving from `/pricing` ("You picked Pro, yearly. You'll pay after you confirm your email.").
- **Results:** checks on → `/verify`; approval → a card "Thanks, {name}. {contact} will review your request. We'll email you when it's ready." (no mail: "Ask {contact} to approve it."); otherwise a full load with "Welcome to {install name}".
- **States:** closed → "Sign-up is closed. Ask {contact} for an invite."; invite only → "This Fuobe is invite only."; domain refused → "Sign-up here is limited to @studio.com addresses."; throwaway address → "Use a permanent email address."; common password → S1.3 copy; breached password (Platform) → "That password has appeared in a data breach. Choose another one."; an existing email → the same "Check your email" screen as a new one (no enumeration).

### S2.4 `/verify`, `/reset`, `/reset/[token]` [acc-11]

- **`/verify`:** MailCheck tile, H1 "Check your email", "We sent a 6-digit code to {email}." Code input (autosubmit), "Resend in 24 s" (then "Resend code"), "Wrong address? Use a different email" (back to `/register` with fields kept; the unchecked account is discarded). Errors: "That code didn't match. Try again." / "That code expired. Send a new one."
- **`/reset`:** email field, "Send code" → always "If an account uses {email}, we sent a code." → code plus new password → "Password changed. You've been signed out everywhere." with Sign in (no automatic sign-in). Studio or Platform without mail: "Ask {contact} for a reset link." Referrer-Policy no-referrer.
- **`/reset/[token]`** (admin-made link): "Choose a new password" for {email}; expired or used → "This link has expired or was already used. Ask for a new one." Two-step stays on after a reset.

### S2.5 `/invite/[token]` [acc-12]

- Card: inviter avatar, H1 "{inviter} invited you to join", the team or install name and the role line ("You'll join as an Editor: you can create and share in the team.").
- Signed in as the invited email: "Join {team}" (primary) and "Decline". Signed out: "Create account to join" and "I already have an account". Signed in as someone else: "You're signed in as {current}. This invite is for {invited}." with "Switch account".
- States: expired → "This invite expired. Ask {inviter} for a new one."; revoked → "This invite was cancelled."; used → "This invite was already used. Sign in instead."; unknown → "We couldn't find this invite. Check the link."; admin role with an unchecked email → "Check your email first. We sent a code to {email}." Pages are `no-store`.

### S2.6 `/recover` [acc-13; checkboxes acc-19]

- **Step 1:** KeyRound tile, H1 "Recover your account", "Enter the code that fuobe recover printed on the computer where Fuobe runs." Input "Recovery code" `XXXX-XXXX-XXXX` (case-insensitive; O read as 0, I and L as 1). A `#CODE` in the URL fills and submits, and the fragment is cleared.
- **Step 2:** H1 "Choose a new password"; with acc-19, checkboxes "Turn off two-step sign-in (I lost my authenticator)" and "Remove my {n} passkeys"; note "Every device will be signed out."; "Save password".
- **Done:** "Password changed. You've been signed out everywhere." with Sign in; an email and Inbox notice go to the account.
- **Errors:** "That code doesn't match. {n} tries left." / "That code was used up. Run fuobe recover again." / "That code expired. Run fuobe recover again." / "There's no recovery code waiting. Run fuobe recover on the computer where Fuobe runs." / Just me: "Sign-in is off on this Fuobe, so there's nothing to recover."

### S2.7 Copy for every sign-in refusal code

| Code | Copy on `/login` |
|---|---|
| `ACCOUNT_PENDING` | "Your account is waiting for approval. We'll email you when it's ready." (no mail: "Ask {contact} to approve it.") |
| `ACCOUNT_DISABLED` | "This account is turned off. Ask an admin to turn it back on." |
| `ACCOUNT_DORMANT` | "This Fuobe is in personal mode right now, so other accounts can't sign in. Ask {contact} to switch it back." |
| `NETWORK_NOT_ALLOWED` | "You can sign in only from your studio's network. Connect to it or ask an admin." |
| `SEAT_WAIT` | "All seats are taken. An admin has been asked to give you one." |
| `SSO_REQUIRED` | "studio.com uses company sign-in." with "Continue with {provider}" |
| `ACCOUNT_DELETION_PENDING` | sends the person to `/account/restore` (S4.8) |
| `ACCOUNT_SUSPENDED` | "This account is paused while we review it. We'll email you within 48 hours." |
| `ACCOUNT_BANNED` | "This account was closed on {date} for breaking our rules ({policy}). You can appeal until {date}." with "Appeal" (S8.6) |
| `SERVICE_PREVIEW` | "{service} isn't open yet. Join the waitlist." with the waitlist link |
| `PASSWORD_LOCKED` (423) | S2.1 |
| `TWO_STEP_REQUIRED` (tokens) | CLI and API: "Two-step sign-in is required. Set it up in the browser, then create a new token." |

## S3. Shell [acc-13 unless marked]

### S3.1 Account menu and phone sheet

- **Trigger:** the sidebar footer gets a 42 px profile button (24 px avatar, name, chevron) plus a settings icon; icon mode shows the avatar with a tooltip. Just me keeps today's footer. Phone: a 32 px avatar in the PhoneBar opens the same items in the ResponsiveDialog sheet.
- **Menu** (280 px): header with name, email, plan (Platform) and the spend pill ("≈ $12.40 this month" / "≈ $12.40 of $25" / "1,240 credits"; highlight token above 80%). "Workspaces" (S3.3). Then Inbox (count), Approvals (acc-28, approvers), Account, Usage, Plan & billing (Platform), Admin console (admins), Appearance (Light / Dark / System), Sign out.
- **Sign out:** `POST /api/auth/logout`, clear namespaced storage, `location.assign('/login')`.
- **Keyboard:** Radix menu (arrows, Enter, Esc); the trigger has `aria-haspopup="menu"`.

### S3.2 Inbox bell

- A Bell icon button with an unread badge (`aria-label="Inbox, 3 unread"`): desktop in the sidebar header next to Search (icon mode keeps it); phone in the PhoneBar between the wordmark and Search. The avatar also shows a dot when there are unread items.
- **Popover** (360 px; phone: the 85svh sheet): "Inbox" heading with "Mark all read". 56 px rows: icon, title, two-line body, relative time, unread dot. Clicking marks read and navigates. Links are stored as validated relative paths only; bodies render as text. Empty: "You're all caught up." Loading: 3 skeleton rows. Error: S0.4.
- Refetch every 60 s and on focus. Keyboard: arrows move, Enter opens, `m` marks read.
- Approvers see a "Needs you · 2" chip on Home above the composer when requests wait for them.

### S3.3 Workspace switcher

- In the account menu: "Personal" (check mark when active), then the 5 most recently used teams with colour dot and role, "Find a team…" (a cmdk field from 8 teams up), "All teams" → `/teams`, "+ Create team" (when allowed; S5.1). After a Studio → Personal switch the owner sees "Spaces" instead of "Teams".
- Switching sets the tab's space and `fuobe:u:<id>:space`, invalidates workspace-scoped queries and shows "Now in Brand team". ⌘K "Switch workspace…" lists the same.

### S3.4 Banners

All banners sit above the page content, one line plus up to two actions, `role="status"` (alerts use `role="alert"`), dismissible where stated.

| Banner | Copy | Actions |
|---|---|---|
| New sign-in (acc-20) | "New sign-in: Safari on iPhone, 12 min ago. Was this you?" | Yes · Review devices |
| Just me from another device (acc-18) | "You're using Fuobe from another device without sign-in. Anyone who can open {host} can use it and your keys." | Turn on sign-in · Dismiss (7 days) |
| Two-step grace (acc-30) | "Your studio requires two-step sign-in from {date}. Set it up now. It takes a minute." | Set up |
| View-as (acc-35, acc-42) | "Viewing Lee's library as an admin · read-only · logged · ends in 29 min" | Stop |
| Idle warning (acc-30, AlertDialog) | "You'll be signed out in 2 min because you've been away." | Stay signed in |
| Platform Preview (acc-47) | "Preview · only staff and testers can sign in." | Open to the public (owner) |
| Past due (acc-45) | "Your last payment didn't go through. Paid runs continue until {date}." | Update payment |
| Frozen (acc-45) | "Paid runs are paused while a payment is reviewed." | — |
| Development Platform | "Development build: the public service isn't finished. Don't open it to the public." | — |

### S3.5 Confirm it's you

ResponsiveDialog: H1 "Confirm it's you", "For your safety, confirm before changing sign-in settings." Password field with "Confirm" (writes a 10-minute step-up); with a passkey, "Use a passkey" is primary; provider-only people get "Continue with {provider}" (the pending action is restored after the redirect with the toast "Confirmed. Finish {action}."). Errors: "That password isn't right." / "Passkey check was cancelled." The original action continues after success.

### S3.6 Member welcome card (Home)

- **Who:** Studio members and auditors who haven't dismissed it (`guide.dismissed`); replaces the Get started guide.
- Card: H2 "Welcome to {studio}, {name}". Lines: "Things you make are private to you unless you share them or make them in a team."; the money line by mode ("Your limit: ≈ $25 a month on the studio's keys." / "Runs on paid models use your own key here." / "Your own keys pay first; then the studio's, up to $25 a month."); "You're in Brand team (Editor)." when in a team.
- Chips: "Add your key to start" (first when keys.mode is own and no key), "Make an image", "Make a video", "Open Brand team". "Hide" → `guide.dismissed`.

## S4. Settings

### S4.0 The settings sub-nav [acc-15]

A chip row under the H1 from a registry filtered by S0.3: General, Account, Access, Usage, Plan & billing, Data & privacy, Backup, Models & licences, About. The current chip has `aria-current="page"`. The row is not sticky; it scrolls inside its own container on phone. The connection `StatusStrip` shows only on General, and only for admins. `/settings#security` stays as a summary card linking to Account and Access.

### S4.1 `/settings/account` [acc-13; tokens and keys acc-8/13]

Sections in the Section layout:

1. **Profile:** avatar (upload, max 2 MB, cropped square; removing shows initials), name (saved on blur; toast "Saved"). Email row: "No email" / "{email} · Not checked yet" / "{email} · Checked", with Add or Change (step-up; a code to the new address). Members without mail: "Ask an admin to change your email." SSO or SCIM managed: "Managed by your company".
2. **Sign-in:** "Change password" dialog (current, new, "Sign out other devices" ticked by default); `FUOBE_PASSWORD` shows "Set by the server (FUOBE_PASSWORD)". Connected sign-ins (Google, GitHub, OIDC, company) with Connect and Disconnect; the last method can't be removed ("Add another way to sign in first."). "Connect company sign-in" for people at a bound domain (acc-32).
3. **Passkeys and Two-step** (S4.2).
4. **Devices** (`GET /api/me/sessions`, no tokens): rows "{Browser} on {OS}", "This device" badge, "Signed in {rel} · Active {rel}", IP when behind a trusted proxy, "Sign out". Footer "Sign out other devices" → "Signed out of {n} devices". Switch "Email me when a new device signs in" (acc-20).
5. **API tokens:** "Create token" dialog: Name ("Laptop CLI"), Access (Full / Generate only / Read only; Admin for admins), Expires (30 days / 90 days / 1 year (default) / Never), "Only in this workspace" (optional pin). Shown once in a copy box with "You won't see this token again." and the MCP snippet (`claude mcp add --transport http fuobe <origin>/api/mcp --header "Authorization: Bearer …"`). Rows: name, prefix, access, workspace, "Last used {rel}", expiry; expired rows read "Expired on Oct 1" with "Create a new one". Empty: "No tokens yet. Create one for scripts, or run fuobe login to connect the command line."
6. **Your keys** (own or both): fal.ai, Replicate, Anthropic, each with Save & test (`POST /api/me/keys/test`) and Remove; line "Runs use your key first and are billed to your account at the provider." Errors: "fal.ai didn't accept this key."
7. **Notifications:** "Email me about requests and alerts" (needs a checked email and mail).
8. **Appearance:** Light / Dark / System.

**Just me variant:** a card "Sign-in is off, so there's no password, passkey or device list. Turn on sign-in to use Fuobe safely from other devices." with "Turn on sign-in" (→ Access); then API tokens (created by the local actor) and Appearance.

### S4.2 Passkeys and Two-step [acc-19]

- **Passkeys.** Unavailable states: "Passkeys need a secure address. Set an https site address in Settings → Access." / "Passkeys work at {site}. You're on {current}." / "This browser can't make passkeys." Rows: name (inline rename), "Added {date}", authenticator name, "Synced" badge, Remove (AlertDialog "Remove this passkey? You can't use it to sign in any more."). "Add a passkey" (step-up; default name "{Browser} on {OS}"; at most 10). Errors: "Passkey wasn't added." / "This device already has a passkey for {host}." / "You have 10 passkeys. Remove one to add another." Empty: "No passkeys yet. Add one to sign in with your fingerprint, face or device PIN."
- **Two-step.** Off: "Two-step sign-in asks for a code from your phone after your password." and "Turn on". On: "On since {date} · {n} of 10 backup codes left" with "Make new backup codes" and "Turn off" (both step-up).
- **Setup dialog** (ResponsiveDialog, 3 steps): 1 confirm password; 2 a 200 px QR code (`uqr`, dark on white), "Can't scan it? Enter this key:" with the secret grouped in fours and Copy, then a 6-digit code to verify; 3 ten backup codes with "Copy all" and "Download .txt", and the required checkbox "I saved these codes" that enables Done (Esc disabled on step 3). Closing during step 2 discards the half-made factor. Toast "Two-step sign-in is on".

### S4.3 `/settings/usage` [acc-8; Personal labels acc-23; Platform acc-38]

- H1 "Usage", a month picker (last 12 months), "Download CSV".
- Big number: Personal "Spent this month ≈ $12.40" with "Resets on Nov 1 ({zone})."; Studio "≈ $12.40 of $25 this month" with a Progress bar; Platform: credits used, left and refunded cards. A second card shows own-key spend ("Your own keys ≈ $3.10").
- Table (cards on phone): date, what (feature and model), workspace, paid by ("Studio key" / "Your key" / "Team key" / "Studio GPU" / "Demo"; Personal: "fal.ai key", "Replicate key", "Anthropic key", "Your GPU"), cost ("≈ $0.42", "price unknown", "free"; Platform "−12", "Refunded +12"). Infinite scroll; skeleton rows while loading.
- Personal cap row: "Stop paid runs when this month passes [$ ]" (0 blocks paid runs).
- Studio: "Ask for more" (ResponsiveDialog: $10 / $25 / $50 / Custom and a note) → "Asked for $25 more · waiting".
- Empty: Personal "No paid runs this month. Runs on your own GPU are free."; Studio "No paid runs this month. Runs on the studio's GPU don't count toward your limit."
- Footer (USD modes): "Amounts are estimates from each model's list price, not your provider's bill."

### S4.4 `/settings/access` [acc-15; Personal sections acc-18]

1. **Mode** card: "Running as: Just me on this computer" (or Personal with sign-in, Studio, Platform) with "Change mode" (owner). Dialog: three radio cards; below, the consequences in plain words ("8 people will be signed out and can't sign in until you switch back. Their libraries and teams are kept. A backup is saved first."), a checklist from the mode packages (email checked, a non-loopback site address, sign-in on, subscriptions ended) with each unmet row linking to its fix, and "Switch". Studio and Platform targets continue in `/setup/<step>?switch=<mode>`. Toast "Now running as a studio".
2. **Require sign-in** (Personal): switch. On → a dialog for name, optional email, password and site address (`POST /api/access/sign-in`). Off → AlertDialog "Turn off sign-in? Anyone who can open this address will have full access to Fuobe and your keys. Your passkeys and devices are kept for when you turn it back on."
3. **Who can join**, **Sign-in methods**, **Email** (with "Recent problems": the last 5 delivery errors), **Site address and time zone**, **Contact on sign-in pages** (default "the {install name} admin"), **Share links** ("Anyone with the link" / "Only people signed in here" (not in Personal) / "Nobody").
4. **Personal additions (acc-18):** Site address check lines (S1.4 plus "You're using this address right now." and "This address is this computer only. Other devices can't open it."; changing the host warns "Your {n} passkeys were made for {old} and won't work at {new}."); **Other addresses** (chips; env entries locked; refusals "Use a full name like studio.lan, not a pattern." for `*`, wildcards and ranges, and "Quick tunnel addresses can't be added. They're public and change every time."; a public name asks "Anyone who can open {name} will have full access. Turn on sign-in instead?"); **Behind a proxy** (switch, hop count or CIDRs, "Fuobe sees you as 203.0.113.7"); **Remote guide** cards: Same Wi-Fi (LAN addresses with a QR code), Tailscale (Recommended; `tailscale serve --bg 3000`), Cloudflare Tunnel and Caddy (shown only with sign-in on), "Keep the plain port private" (`pnpm start -H 127.0.0.1`).

Non-admins get 404.

### S4.5 `/settings/backup` [acc-21]

H1 "Backup & move", "Backups are saved in {dir} on this computer." 1 "Back up now" (after 10 s "Still working… large libraries take a little longer."; toast "Backup saved"). 2 Automatic: Off / Daily / Weekly, keep 1–30 ("Automatic copies are the database and its key, not your files."), last error shown. 3 List: date, kind chip (Manual, Automatic, Before mode change, Before accounts update), size, key icon, ⋯ Download (a single-use 60 s link) / Delete. Empty: "No backups yet." 4 "Download a full backup": checkboxes for files, trained LoRAs, datasets with sizes; the warning "This file holds your API keys and everything you made. Keep it somewhere safe."; step-up; in Studio and Platform a required reason ("Why are you downloading everything?") and the note "Admins are told." 5 Moving steps. 6 The restore command.

### S4.6 `/settings/account/connect-cli` [acc-22]

Auth card "Connect the command line": "A fuobe login on {client} wants a token for this Fuobe." The code in large mono with "Check that your terminal shows the same code." Request details: "From 203.0.113.7 · fuobe-cli 0.9 on macOS · 2 min ago". Fields: Name ("fuobe CLI on {host}"), Access (default Generate only), Expires (default 1 year). Warning "Only approve if you just ran fuobe login yourself." Buttons "Connect" (step-up) and "Don't connect". States: "Connected. You can close this tab and go back to the terminal." / "This code isn't valid. Run fuobe login again." / "This request expired. Run fuobe login again." Terminal side: `fuobe login` prints the code and URL, polls every 2 s, then "Connected as {name}"; `fuobe status` prints "Fuobe at {url} · Just me on this computer (no sign-in)" or "Signed in as {name} · {workspace}".

### S4.7 Composer refusal lines and the payer hint [acc-8]

One 13 px line under the prompt with AlertCircle; Generate is disabled with `aria-describedby` pointing at it; open-engine models stay runnable. A pre-check from `/api/me/usage` shows the line before submit.

| Case | Line | Action |
|---|---|---|
| Member limit | "You've reached this month's limit (≈ $25)." | Ask for more · (both mode) Use my own key |
| Team limit | "Brand team reached its limit for this month." | Ask a team admin |
| Personal cap | "You reached your $50 limit for this month." | Change limit |
| Own keys required, none set | "Runs on paid models use your own key here. Add your fal.ai key to start." | Add key (inline dialog: field, Save & test, "Your key is encrypted and only used for your runs.") |
| Unknown price | "This model has no listed price, so it can't run on the studio's keys. Ask an admin." | — |
| View-only seat | "Your account is view-only. Ask for a full seat." | Ask for a seat |
| Viewer in a team | "You can view Brand team but not make things in it." | Switch to Personal |
| Cross-space input (409) | "These come from your personal library. Using them copies them into Brand team." | Use them · Cancel |
| Platform credits | S8.4 | |

The payer hint sits next to the price on the Generate button tooltip: "Your key", "Studio key · ≈ $0.42", "Team key", "No key yet"; with a team active, "Saves to Brand team".

### S4.8 `/settings/privacy` and `/account/restore` [acc-35; Platform defaults acc-53]

- H1 "Data & privacy".
- **Download my data:** checkbox "Include trained LoRA files"; "Prepare download" → a progress row "Preparing · 34%" → "Ready · 2 parts · 3.1 GB · until Nov 5" with Download per part. Errors: "Couldn't prepare your export. Try again." / "This download expired. Prepare a new one." Platform: one export a day ("You can prepare another export tomorrow.").
- **Delete my account:** Studio with self-delete off: "To delete your account, ask an admin. Your personal library will be deleted 30 days after they do." with "Ask an admin" (an Inbox request). Owners and last team owners: "Transfer ownership of Brand team first." with a link. Where allowed: step-up, then AlertDialog "Delete your account?" listing "Your personal library ({n} results, {size}) is deleted after 30 days"; "Things you made in teams stay with the teams"; Platform "Your {plan} plan ends now and isn't refunded" (or the operator's rule) and "Your {n} credits are lost"; "Sign back in before {date} to cancel". An optional reason select, a field "Type Delete to confirm", the destructive button "Delete account". Then sign-out with the toast "Your account will be deleted on {date}." During the grace the email can't register again ("This email belongs to an account being deleted. Sign in to restore it.").
- **Platform additions (acc-51):** Notices (date, a blurred thumbnail, decision, rule, "Appeal" for 6 months) and support access requests ("Support wants to view your account for 30 minutes to help with: {reason}." Allow / Decline).
- **`/account/restore`:** "Your account is set to be deleted on Dec 1." with "Restore my account" (self-deleted accounts only) and "Sign out".

### S4.9 Generation and chain card states [acc-9; queue acc-26; safety acc-50]

| State | Card copy | Actions |
|---|---|---|
| Queued | "Queued" | Cancel |
| Waiting for a GPU (acc-26) | "Waiting for a GPU · 3 ahead" (or "· it isn't answering") | Run on cloud instead (confirm "≈ $0.42 · Studio key") · Cancel |
| Waiting for approval (acc-28) | "Waiting for approval" | Withdraw |
| Running | progress | "Stop · it has started, so ≈ $0.42 is still charged" (Platform: "≈ 12 credits") |
| Canceling | "Stopping…" | — |
| Saving results | "Saving results" | Cancel answers "Already finishing. This run will be charged." |
| Stopped (chain) | "Stopped at step 3 of 5 · needs 40 more credits (you have 12)" / "· you reached this month's limit" | Add credits or Ask for more · Continue (re-runs only the stopped steps) · Cancel the rest |
| Held for review (acc-50) | blurred placeholder, "Being checked · usually a few minutes" | — |
| Blocked (acc-50) | "This result was blocked by the safety check. 12 credits refunded." | Appeal |
| Paused owner | "Paused: the account that started this is off." | — |
| Failed | the provider's message in plain words | Retry |

Stopped steps keep 7 days, then cancel and release ("Stopped steps were cancelled after 7 days. Nothing was charged for them."). Assist shows "I stopped before step 3: not enough credits." with the same buttons; scheduled tasks pause with an Inbox notice "Your task "{name}" paused: not enough credits."

## S5. Teams and sharing [acc-17 unless marked]

### S5.1 Create team

ResponsiveDialog "Create a team": Name (1–40; placeholder "Brand team"), Colour (8 dots, radio group), Visibility (Studio: Private / Listed / Open with one-line help, default Listed; Platform: Private only), "Invite people" (optional emails). Primary "Create team". Error "A team with this name already exists." Result: `/teams/[slug]` with the toast "Brand team created". Platform without a Team plan: the line "Runs in this team are paid from each person's own credits. Get the Team plan to share credits." with "See Team plan".

### S5.2 `/teams/[slug]/settings`

Tabs (a Select under 600 px): Members / Keys & limits / Policies (acc-25) / Activity (acc-34) / General.

- **Members:** search; rows (avatar, name, email, role select, source badge, this month's spend); role help "Owner: everything, including deleting the team" / "Admin: manages people, keys and limits" / "Editor: creates and shares in the team" / "Viewer: sees and downloads, uses no budget". "Invite" (Studio: a picker of people plus emails; Platform: emails; with a seat-billed plan: "Adding Lee adds a seat: $25 a month. You pay $13.40 today (prorated)." with "Add and pay"); "Copy invite link (expires in 72 hours)"; pending invites with Resend and Revoke; resend guard "You sent an invite in the last 5 minutes. Try again soon." SCIM members locked ("Your directory manages this."). Remove: AlertDialog "Remove {name} from Brand team? What they made stays with the team. Their queued runs here are cancelled." Waiting to join (acc-24): "Add as Editor ▾" and Decline. Empty (only you): "It's just you so far. Invite people to share work here."
- **Keys & limits:** team keys ("Team runs use these keys before the studio's."), team monthly limit, per-member limit, approvals threshold (acc-28), spend by member.
- **General:** name and colour, description, visibility, "New people join as", who edits brand kits, public links, "Members may copy team content to their personal library" (off by default in Studio), Export team (acc-35), Leave, Delete.

### S5.3 Leave, transfer and delete

- **Leave:** AlertDialog "Leave Brand team? Your work stays with the team. Your scheduled tasks here pause." The last owner sees "Transfer ownership first." with a link.
- **Transfer ownership:** "Make {name} the owner of Brand team? You'll become an admin. Only the owner can delete the team." (install level: "Make {name} the owner of {install}? You'll become an admin. Only the owner can change the mode, roles and billing.") Step-up.
- **Delete:** AlertDialog with a choice: "Move everything to another team" (picker of teams where you are admin) or "Archive for 30 days, then delete"; the note "Characters made from people's faces and cloned voices go back to the people who made them."; "Type Brand team to confirm". Every member gets "Brand team was deleted by {name}. {What happened to the work}."

### S5.4 The Saving-to chip

- An `h-7` chip left of the model picker: "Personal ▾" or "● Brand team ▾" (team colour dot). The menu lists spaces where the person is Editor or more; Viewer spaces are disabled with "View only". Inside a project the chip is read-only: "In Brand team". Shown whenever the person has any team; hidden otherwise.
- **Phone:** its own 32 px row above the prompt, left aligned, team names truncated at 14 characters; the existing chip row is unchanged.
- New tabs start in the last-used space; links with `?space=` set it.

### S5.5 Share, Move, Duplicate and the cross-space confirm

- **Share** (the existing Share dialog gains a "People and teams" section above the public link): a field "Add people or teams" (Studio: picker limited to people who share a team with you; Platform: exact email with the uniform answer "If {email} has an account, they can see it now. Otherwise, they'll see it after they sign up with this email."), level Can view / Can edit (capped at your own), the list of grants with Remove. Viewers see "You can't share this." Public link rows follow the space's policy ("Public links are off in Brand team.").
- **Move:** "Move 3 results to Brand team? Your teammates in Brand team will see and use them. They'll leave your personal library." Face elements: "This character is made from a real person's face. Confirm you have their permission to share it with Brand team." → toast "Moved to Brand team" with Undo (8 s). Moving out of a team without team-admin rights: "Ask a team admin to move this out, or duplicate it if the team allows."
- **Duplicate:** "A copy goes to Brand team. Your original stays here."
- **Cross-space confirm (409):** "These come from your personal library: {names}. Using them copies them into Brand team." with "Use them" and "Cancel".

### S5.6 Library spaces

- **Top row:** a space control styled as a chip Select: "Personal ▾ / Brand team ▾ / Shared with me / All my spaces"; defaults to the active space and follows the Saving-to choice. Hidden for people with no team and no grants.
- **Second row:** the existing kind tabs (All, Images, Videos, Audio, Text, 3D, Favorites, Uploads, Links, Trash): "Shared" is renamed **Links**. Favorites are the viewer's own across the selected space; Trash shows the selected space's trash (team trash visible to members, restorable by the creator or a team admin); Uploads are filtered by space. Filters gain "Made by me".
- Team items show the creator's avatar (16 px) on the tile.
- **Empty states:** Brand team: "Nothing here yet. Make something with Saving to: Brand team, or move results here."; Shared with me: "Nothing shared with you yet. When someone shares a result, folder or project with you, it shows up here."; All my spaces: today's empty state.
- **Phone:** the space chip and the scrollable tab strip fit one 390 px row each with edge fades.

## S6. Admin core [acc-16]

### S6.1 Shell and nav

`/admin` layout with a 220 px nav from a registry, grouped: Overview; People (People, Teams, Seats, Bans); Money (Usage & limits, Approvals, Plans, Credit prices, Codes, Payments); Content (Moderation, Models & features, Announcements); Compute (GPU); Sign-in & security (Access, Security, Company sign-in, Provisioning, Domains); Records (Audit log, Data & retention); System (Settings, Health). Items appear only when their package and the person's permission exist. Under 768 px the nav is a Select at the top. Others get 404. ⌘K adds the admin pages the person can open.

### S6.2 Overview

A checklist card from a registry (Studio "Finish setting up": Connect your GPU, Add the studio's keys, Verify your email domain, Set up company sign-in, Turn on two-step for yourself, Invite your people, Create a team — "3 of 7 done", "Hide this list"; Platform: the launch checklist, S9.1). Stat tiles (People, Spend this month, GPU busy, Security: two-step coverage). "Needs you": waiting sign-ups, join requests, limit and seat requests, approvals, lapsed domains, SSO or SCIM errors, mail failures; each row links to its page. Empty: "Nothing needs you right now." Loading: tile skeletons.

### S6.3 People and the person page

- **`/admin/people`:** tabs Active / Waiting for approval / Invited / Turned off; search (name or email); "Invite people"; "Download CSV". Columns: person (avatar, name, email), role, teams, this month ("≈ $12.40 of $25" and "own keys ≈ $3.10"), last active. Phone: card rows with a ⋯ menu. Empty states: Waiting "No one is waiting. New sign-ups appear here when approval is on."; Invited "No open invites."; Turned off "No one is turned off."
- **`/admin/people/[id]`:** header with avatar, name, email, role chip, seat chip, two-step chip, SSO and provisioned chips; tabs Overview, Usage, Devices, Tokens (Activity from acc-34; Credits, Billing and Safety in Platform). Actions (⋯, each following the target-role matrix in `accounts-8.md` §7.3): Set monthly limit; Send a reset email (or "Create reset link" without mail: "Works once, for 60 minutes. Their other devices will be signed out. Two-step stays on."); Sign out everywhere; Reset two-step (owner); Turn off ("Turn off {name}? They're signed out, their tokens stop working and their scheduled tasks pause. Their work is kept." with a picker for a new owner of teams they solely own); Change role (owner); Transfer ownership (owner); Delete account (acc-35); Open library… (acc-35). Tokens tab: name, access, last used, Revoke. Every action ends with a toast and the person gets a notice.

### S6.4 Teams

`/admin/teams`: columns name (dot), visibility, members, owner, this month's spend, created; search; "Create team"; ⋯ Open, Settings, Reassign owner, Archive. Studio "Team rules" card (acc-24): who creates teams, default visibility, who adds team keys. Empty: "No teams yet. Create one to share work."

### S6.5 Usage & limits (and Studio reports, acc-29)

Totals by payer (studio keys, own keys, team keys, GPU hours); the default monthly limit; "Allow runs with an unknown price on the studio's keys" (off); the limit-request queue (rows "Dana asks for $25 more · 'Client deadline'" with Approve $25 / Approve custom / Decline; toast "Approved $25 for Dana"). With acc-29: a period select (up to 13 months), tabs Overview / People / Teams / Models / GPU / Requests, an SVG day chart with "Show as table", "Alerts" dialog (50/80/100%, monthly report), ⋯ "Pause paid runs" per person. CSV with a byte-order mark; cells starting with `=`, `+`, `-` or `@` are prefixed with `'`. Empty: "No spending yet this month."

## S7. In-house studio

### S7.1 `/teams` — directory [acc-24]

H1 "Teams" with "Create team" (if allowed) and a search field. "Your teams": cards (colour dot, name, role chip, up to 5 avatars, "3 new this week"), ⋯ Work here / Settings / Leave. "Other teams": Listed and Open teams with "Join" (Open) or "Ask to join" (Listed; optional note; toast "Request sent"); a pending request shows "Asked · waiting" with Withdraw. Private teams never appear to non-members. Empty: "You're not in a team yet." (and, for people who may create teams, "Create one to share work with others."). Phone: one column of cards.

### S7.2 `/teams/[slug]` — team home [acc-24]

Header: colour dot, name, description, member avatars, role chip, primary "Work in Brand team" (sets the space and opens Home) or, for Viewers, "Browse". Sections (each with "See all"): This month (spend, runs), Recent (12 tiles), Folders, Projects (chip filter: Cinema, Canvas, Shorts, Swap, Faceless), Characters & styles, Brand kits & products, Presets, palettes & skills. A new team shows one card: "Brand team is ready. Make something with Saving to: Brand team, move results here, or invite people." with "Start making" and "Invite people". Non-members of Listed or Open teams see a preview (name, description, member count, "Ask to join" or "Join"); Private teams answer 404. Removed meanwhile: "You're no longer in Brand team." with "Go to Personal".

### S7.3 `/approvals` [acc-28]

- **Requester:** toast "Sent to Brand team admins for approval · ≈ $14.20" with "Add a note" and "View"; the card state S4.9; outcomes in the Inbox: "Approved by Sam. The runs are starting." / "Declined by Sam: {note}" / "The approval request expired."
- **Approver page:** H1 "Approvals", tabs Waiting (n) / Decided. Admins also see the "Personal spaces" card ("Runs over $[ ] on the studio's keys need an admin's OK"). Request cards: requester, space chip, "Video · Kling 3.0 · 4 runs", "≈ $14.20 (over the $10 limit per run)", payer, note; team requests show the prompt and inputs; personal ones show "Private run: details stay with Dana."; Decline (reason) and Approve. Bulk bar on selection. Toasts "Approved. The runs are starting." / "Sam already decided this." Empty: "No runs are waiting for approval." Decided tab empty: "Nothing decided yet."

### S7.4 `/admin/security` and `/two-step/setup` [acc-30]

- **`/admin/security`:** sections saving after step-up: Two-step ("Require two-step sign-in for": Off / Owner, admins and auditors / Everyone; grace Right away / 3 / 7 / 14 days; "Remember this device" Never / 7 / 30 days; coverage "38 of 42 people have two-step"); Sessions (length 8 hours / 1 day / 7 days / 30 days; "Sign out after inactivity" Never / 30 min / 1 hour / 8 hours / 24 hours; "Devices per person" no limit / 1–10); Allowed networks (CIDR list; needs a trusted proxy; "Your address 203.0.113.7 isn't in this list. Add it first."); API tokens ("Longest token lifetime"); "Sign out everyone" (AlertDialog "Everyone, including you, signs in again."); "Revoke everything" (owner; AlertDialog "Everyone, including you, signs in again. Scripts and the command line need new tokens. Remembered devices are forgotten.").
- **`/two-step/setup`:** the auth card for a restricted `enroll-2fa` session: H1 "Set up two-step sign-in", "Your studio requires it from Nov 5."; "Add a passkey" (primary when available), "Use an authenticator app" (the S4.2 dialog steps inline), "Sign out".

### S7.5 Company sign-in [acc-32]

- **`/login`:** "Continue with company sign-in" → `/login/sso`: "Work email" → redirect to the bound connection. No connection: "No company sign-in is set up for @gmail.com." Enforced domains switch the card to "Continue with Okta" with "studio.com uses company sign-in." After return: toast "Signed in as dana@studio.com". Errors: not provisioned "Your company account isn't set up here yet. Ask your admin."; `account_exists` "Sign in with your password, then connect company sign-in in Settings → Account."; generic "Company sign-in didn't work. Try again or ask your admin." (details in the audit log).
- **`/admin/sso`:** list (provider, domains, status chip Draft / Tested / Required / Error, last sign-in), "Add connection" (owner), the break-glass card (owner plus up to 2 admins who may still use passwords). Empty: "No company sign-in yet. Connect Okta, Entra ID, Google Workspace or any OIDC or SAML provider." with "Add connection".
- **Editor** (`/admin/sso/[id]`, owner; step-up): 1 Provider preset (Okta, Entra ID, Google Workspace, Keycloak, Authentik, Other OIDC, Other SAML). 2 Values to copy: Redirect URI `<site>/api/identity/sso/callback/<id>`; ACS `<site>/api/identity/sso/saml2/sp/acs/<id>`; Entity ID; SP metadata link. 3 OIDC: issuer, client id, secret, Check; SAML: metadata URL or XML or manual certificate and SSO URL; "Allow a private-network address" (owner). 4 Bound domains (only verified domains not bound elsewhere). 5 Accounts: create accounts on first sign-in (on), default team and role, "Trust this provider's two-step" (on), groups to teams. 6 "Require company sign-in for these domains" (needs a test passed in the last 24 hours). "Test sign-in" → "It works. Fuobe received dana@studio.com · Dana Ruiz · groups: Design. No account was created." or the plain error ("The response wasn't signed." / "The audience didn't match {entity}." / "The clock on the identity provider is more than 2 minutes off.").
- **`/setup/sso`:** the same editor as an optional wizard step ("Skip for now").

### S7.6 Provisioning, domains and seats

- **`/admin/provisioning`** [acc-33]: Base URL `<site>/api/scim/v2` with Copy; tokens (at most 3; "New token" shows it once; rows with prefix, created, last used, Revoke); Groups → team and role table; "When your directory removes someone": Turn off (default) / Delete after 30 days; safety-brake status ("Paused: the last sync would turn off 14 people. Check your directory, then resume." with "Resume provisioning", owner); Recent activity (time, action, person, result). Empty: "Not connected yet. Paste the base URL and a token into your identity provider."
- **`/admin/domains`** [acc-31]: "Add domain" → a card with the TXT record `_fuobe-challenge.studio.com` and value `fuobe-domain-verification=<token>` (both with Copy) and "Check now" ("We couldn't find the record yet. Checked at 10:42. DNS changes can take up to an hour."). Status chips Waiting / Verified / Lapsed. Owner: "Mark as verified without DNS" with a reason. Per domain: "People with a checked address here can sign up without an invite" and "Bound to company sign-in: Okta". Empty: "No domains yet. Verify studio.com so colleagues can join without approval."
- **`/admin/seats`** [acc-36]: "18 of 25 full seats used" with a bar; "4 view-only accounts (free)"; seat limit and "When seats run out: make new people view-only" (owner); requests ("Lee asks for a full seat" with "Give full seat"); chips for people inactive 30 days; bulk "Make view-only". Empty requests: "No seat requests."

### S7.7 Audit and data

- **`/admin/audit`** [acc-34]: search; chips Who / What / When / Address; rows with time, who, a plain sentence ("Dana changed Lee's role to Admin"), where (admins only); a details sheet (all fields, previous and new values, request id); the chain banner "Records verified up to {time}" or, in red, "The record changed after {time}. Download the export and contact support."; Export CSV or JSONL; Keep for 90 days / 1 / 2 / 7 years; "Send to a log endpoint" (HTTPS URL and secret, Test). Empty: "No activity matches these filters." with "Clear filters".
- **`/admin/data`** [acc-35]: Legal hold (switch with reason; banner "Legal hold is on since Oct 29. Nothing can be deleted."); Delete old results (per install or team: "Delete results older than [90] days", "Preview" → "The next run would move 1,284 results (38 GB) to Trash. The first run is on Nov 5; people get a notice today."); Accounts being deleted (rows with "Deleting on Nov 28" and Restore); Exports (rows, status); "Let admins open anyone's personal library" (owner; off; "Each time needs a reason, the person is told, and it's logged."); "People may delete their own account" (off); link to Backup.
- **Team Activity** (team settings): the same rows without addresses.

### S7.8 `/admin/gpu` [acc-26, acc-27]

Admins edit; auditors read; refresh every 5 s.

1. **Servers:** rows with name, pool, status ("Online · RTX 6000 · 48 GB" / "Not answering since 10:42"), host only, running and "In ComfyUI: 2 of 2", "Take new work" switch, a warning chip "Open to the network" when `/system_stats` answers without a token ("Anyone who can reach this server can see every run. Add a token or keep it on a private network."). "Add GPU server" (ResponsiveDialog): label, address, token, pool, "Only for these teams", LoRA folder, input and output folders (optional; lets Fuobe delete run files), Test ("Connected · RTX 6000 · 48 GB · 412 node types"). Remove: AlertDialog "Runs on it fail with a message and can be run again." Empty: "Using {comfyui.url} from Settings. Add servers here to share work across GPUs."
2. **Waiting:** grouped by team (Platform: by pool and plan); rows with person, model, waiting time; ⋯ Move to front / Cancel run. Empty: "Nothing is waiting for the GPU."
3. **Shares:** team weight Low / Normal / High / Highest with GPU hours this week (Platform shows plan weights and the Free pool cap read-only).
4. **How the GPU is shared:** Fair share / First come, first served; "Waiting runs per person" 50; "Runs per server at once" 2 (1–4); "Longest wait before a run fails" 240 min.

## S8. Platform for customers

### S8.1 `/welcome` (`/` signed out) and `/pricing` [acc-47]

- **`/welcome`:** header (logo, Pricing, Sign in, "Start free"). Hero H1 "Make images and video with the best AI models." line "Start free. Pay with credits for what you make." A composer preview: typing and pressing Generate stores the prompt (sessionStorage) and opens `/register`; after sign-up the prompt is waiting in the composer. Showcase: 12 tiles chosen by staff in Settings → Service ("Pick from published share links"; empty hides the section). Features (4 cards), Free models row, FAQ, footer with legal links and "Report content".
- **`/pricing`:** Monthly / Yearly toggle with "Save 20%" (computed); Individual / Teams chips. Cards (Free, Starter, Pro "Most popular", Ultra): price ("$30 a month, tax included" for consumers), credits chip ("3,300 credits a month"), an example from the price book ("≈ 35 five-second 1080p videos or 730 images"), 6 features, CTA "Start free" / "Get Pro" / "Upgrade" / "Your plan"; for paying customers lower plans read "Switch to Starter" with "from Dec 1, when this period ends". Team: a seat stepper (2–50) with the total. Enterprise: "Talk to us" → a form (name, work email, company, team size, message; "Use your work email." / "Tell us a little about your team."). Packs row (500 for $5, 1,200 for $10, 3,000 for $24). **Cost calculator:** steppers for images, 5 s videos and 10 s videos a month → "You'd use ≈ 1,240 credits a month. Pro fits." Comparison table (scrolls in its own container). FAQ answers: renewal ("Plans renew each month or year on the day you subscribed."), refunds (the operator's rule, default "Within 14 days of your first purchase if you haven't used any of it."), credit expiry and order ("Monthly credits end with the month. Packs don't expire. We always use the credits that expire soonest first."), cancel ("Cancel any time; you keep your plan until the end of the period."), tax ("Prices include tax where we're required to charge it."). No-payments installs: "Request this plan". Test mode: a banner "Test mode: use card 4242 4242 4242 4242". `?checkout=cancelled`: an inline note "Payment cancelled. You're still on Free. Pick a plan when you're ready."
- **Phone:** cards stack; features collapse to "See all features"; the table scrolls inside its container.

### S8.2 `/coming-soon`, `/legal/[slug]`, `/terms-update` [acc-47]

- **`/coming-soon`** (Preview): service name, one line, "Join the waitlist" (email; "You're on the list. We'll email you when we open."), `noindex`.
- **`/legal/[slug]`:** title, "Version {n} · updated {date}", a contents rail (a Select on phone), the text with placeholders filled from settings, a top note on templates "This is a starting point, not legal advice."
- **`/terms-update`** (restricted `accept-terms` session): "We updated our Terms" with a summary of changes, links to the full text, "I agree" and "Sign out".

### S8.3 Register additions and the welcome card [acc-44, acc-47]

Register per S2.3. After email confirmation with a plan picked: "Email confirmed. Taking you to payment…" → Checkout. Welcome card on Home: "Welcome, {name}. You have 50 free credits." (withheld: "Free credits aren't available for this account. Plans start at $10.") with chips Make an image / Make a video / Create a character and the line "Results on Free carry a small {service} badge. See plans".

### S8.4 Billing and credits [acc-37, acc-44, acc-45, acc-46]

- **Credits pill** (account menu and composer header): "1,240 credits" or "1,240 · 60 in use"; a dot when below 10% of the monthly allowance; "On hold" when frozen.
- **Composer credit states:** price label "12 credits" / "Up to 18 credits" / "Unlimited · relaxed" / "Your key". Lines: "This needs 60 credits. You have 24." with "See plans" and "Add credits"; "Kling 3.0 at 1080p is on Pro and up." with the chip "Use 720p"; "Your last run cost 6 credits more than estimated. Add credits to keep going."; "Paid runs are paused while a payment is reviewed."; "Your storage is full. Delete old results or upgrade." Locked studios show an Empty state "Character Swap is on Pro and up." with "See plans". Model picker badges "Pro". A waiting nudge "Pro runs 4 at once." at most once a day.
- **`/settings/billing`:** 1 Plan ("Pro · $30 a month", "Renews on Dec 1" / "Ends on Dec 1" / "Switches to Starter on Dec 1"; Change plan; Cancel → AlertDialog "Cancel auto-renewal? You keep Pro until Dec 1. After that you're on Free." → toast "Your Pro benefits end on Dec 1."; "Keep Pro" when cancelled). 2 Credits: balance, a buckets table (source, left / total, expires; "We always use the credits that expire soonest first."), "Add credits", "Redeem a code". 3 Auto-recharge (Stripe direct): "When I have fewer than [200] credits, add [1,200] for $10" with the line "At most 3 times a day. We'll turn it off if a charge fails." 4 Payment method (card brand and last 4, "Update" → portal). 5 Invoices (date, amount, status, Download). 6 Refund (when eligible: "Refund my purchase from Oct 28. You haven't used any of it." → AlertDialog "Refund $30? Your Pro plan ends now."). Team variant: seats, the pool and member caps. Past due banner (S3.4). Empty invoices: "No invoices yet."
- **Change plan sheet** (ResponsiveDialog): plan cards; the exact charge before confirming ("You pay $26.40 today ($30 minus $3.60 for your 360 unused Starter credits). You get 3,300 credits now, and your plan renews on Nov 29."); downgrades "Switches to Starter on Dec 1. You keep Pro until then."; while unpaid "Pay the open invoice first." 3-D Secure opens a tab and the sheet polls ("Waiting for your bank…").
- **Top-up:** pack picker → "Buy 1,200 credits · $10" → Checkout.
- **`/billing/success`:** "Finishing your purchase…" (polls every 2 s up to 60 s) → "You're on Pro" with "Back to making" / after 60 s "This is taking longer than usual. Your payment went through; your plan will switch in a few minutes. We'll tell you in your Inbox." / unpaid "Your payment didn't go through. Try again."

### S8.5 `/redeem` [acc-42]

Card "Redeem a code", input `XXXX-XXXX-XXXX`, "Redeem" → "Added 500 credits." Errors: "We couldn't find that code." / "This code was already used." / "This code has been used up." / "This code expired." / "This code is for new accounts only." / "Too many tries. Try again in 10 min." No-payments installs link here from "Add credits".

### S8.6 Safety screens for customers [acc-49, acc-50, acc-51]

- **Consent dialog** before a real-face or voice feature: "Is this you, or do you have permission?" with the required box "This is me, or I have written permission from this person, and they're 18 or older." and "Continue".
- **Prompt blocked** (under the composer): "This prompt can't run here: {category in plain words}. Nothing was charged." with "Read the rules". A check that couldn't run: "We couldn't check this prompt. Try again."
- **Held and blocked cards:** S4.9.
- **Report dialog** (share pages, team items) and **`/report`:** category (A minor, Intimate image without consent → `/takedown`, Sexual or violent, Someone's likeness, Copyright (DMCA fields: your contact, the work, the URL, a good-faith statement, signature), Hate, Scam, Other), details, optional email → "Report sent. Thank you."
- **`/takedown`:** NCII form (your name, contact, the URLs, a statement that you didn't consent, signature) → "We'll decide by Nov 3, 14:02 UTC."
- **Notices and appeals:** in Data & privacy (S4.8): "Appeal" opens a form (what you want reconsidered, 1,000 characters) → "Appeal sent. We'll decide within 7 days."; banned people use `/appeal` (email and case id, no sign-in).
- **Ban effects** (per settings): sessions ended; share links show "This link is no longer available."; subscription cancelled with or without a pro-rata refund; credits frozen.

## S9. Platform admin

### S9.1 Overview and the launch checklist [acc-41, acc-57]

Preview: the launch checklist card ("{n} of 12 required steps done"; rows per `accounts-8.md` §10.7, each with its state and a "Fix" link; optional rows below a divider; "Open to the public" disabled until all required rows pass, then AlertDialog "Open {service} to the public? Anyone will be able to sign up." → toast "{service} is open."). Tiles: revenue this month, paying people, credits granted and used, margin (with "Show as table"). "Needs attention": failed webhooks, disputes, moderation over SLA, price changes, spend guard hits. Empty: "Numbers appear after your first day of sign-ups."

### S9.2 `/admin/plans` [acc-40]

List: plan name, price, credits, subscribers, version, status (Live, Draft, Hidden). "New plan". Editor (`/admin/plans/[id]`): Name; Prices per interval (monthly, yearly; "Yearly saves 20%" computed); Monthly credits; Rollover (None / One month); Entitlements (models matrix link, features switches, concurrency cloud and GPU, queue weight, caps: resolution, seconds, outputs, upscale, training photos and steps; storage GB; API tokens and requests a minute; badge on results); Trial (none or N days with an allowance); Visible on pricing. Validation: "Enter a price above $0 or mark the plan Free."; "Credits must be a whole number." Margin check: "At these prices Kling 3.0 1080p runs at a 33% margin." Publish → AlertDialog "Publish version 3? Existing subscribers stay on version 2 unless you move them." with "Also move existing subscribers on renewal". Phone: the editor stacks; the entitlements matrix scrolls inside its container. Empty list: "No plans yet. Start from the recommended template." with "Use template".

### S9.3 People tabs (Platform) [acc-41]

Person page tabs Credits (balance, buckets, ledger with filters, "Adjust credits": amount ±, reason required, caps per role "Support can adjust up to 500 credits at a time."), Billing (plan, subscription status, invoices, refunds, disputes), Safety (reports, strikes, bans, notices). "Request support access" (support role): reason → the customer sees S4.8's request; status "Waiting for Dana to allow" / "Allowed until 14:32". Owner emergency access: reason required, audited, the customer is told.

### S9.4 `/admin/credits` and `/admin/models` [acc-38, acc-40]

- **Credit prices:** value of a credit ($0.01), default markup (50%), GPU price per hour ($2.16), "Unknown prices" (refuse / fixed). Per-model rules table: model, option, provider cost, credits, margin, override; red rows "Below cost: you lose ≈ $0.04 per run"; "Price changed at fal" rows with "Accept new price" / "Keep mine". Live example box ("5 s 1080p Kling = 93 credits"). Empty overrides: "Every model uses the default markup."
- **Models & features:** a plan × model matrix (rows models with licence chips, e.g. "Non-commercial licence"; columns plans; checkboxes) with filters (kind, provider, licence); a banner when a non-commercial model is on a paid plan: "Selling results from models with non-commercial licences may break their terms. Fuobe shows licences as information; the decision is yours."

### S9.5 `/admin/codes` [acc-42, acc-46]

Tabs Credit codes / Promotion codes (Stripe). Credit codes: "New codes": credits, how many, uses per code, expiry, "New accounts only" → shown once ("Download CSV now. You won't see these codes again."). Rows: prefix, credits, used / total, expiry, Disable. Promotion codes: percent or amount off, duration, first-time only, one per card. Empty: "No codes yet."

### S9.6 `/admin/moderation` [acc-51]

Queue with SLA timers ("Due in 47 h" for NCII; red when overdue), filters (category, source: report, classifier, hash match), blurred thumbnails (reveal on click with a warning "This may be disturbing."). Item view: the content, prompt, reporter's note, the uploader's history (strikes), actions Remove / Restrict / Warn / Ban / Restore with a statement of reasons (template per rule, editable). Restricted CSAM tab for the owner only (no thumbnails; report record fields; "Mark reported to NCMEC" with the report id). Keyboard (scoped to the focused queue list, WCAG 2.1.4): j/k next and previous, 1–4 actions, Enter open; announced through `aria-live`. Empty: "Nothing to review. Reports and flagged results appear here."

### S9.7 `/admin/analytics` [acc-56]

Tiles (sign-ups, paying, MRR, churn, credits used, margin), SVG charts per day with "Show as table", tables by model, plan and day, top spenders, abuse signals (accounts sharing a card or network). Period select. Empty: "Numbers appear after your first day of sign-ups."

### S9.8 `/admin/bans` [acc-42]

List (person, reason, until, by, date) with Unban. "Ban someone" dialog: person, reason (select of rules), note, until a date or permanent, "Also refund the current period". Empty: "No one is banned."

### S9.9 `/admin/payments` and `/admin/health` [acc-43, acc-46, acc-56]

- **Payments:** tabs Payments (date, person, amount, status, Refund), Subscriptions (plan, status, renews), Disputes (status, evidence due, Respond in Stripe), Webhooks (event, received, processed, status, Retry; banner "No payment events in 24 hours while 42 subscriptions are active."). Empty: "No payments yet."
- **Health:** queues (waiting by pool, oldest), GPU summary (links `/admin/gpu`), providers (last error, out-of-funds pause with "Resume"), workers and leases, webhooks, backups (last snapshot, Litestream lag), the spend guard ("Paid cloud runs paused: $500 spent in the last hour (limit $400)." with "Raise limit" and "Resume"), tools (reconcile now, re-run price sync).

### S9.10 `/admin/announcements` [acc-57]

Composer: title, body (plain text with links), audience (everyone, a plan, staff), banner on or off, email on or off (sent on the broadcast stream with List-Unsubscribe), start and end time, Preview (light and dark, 390 px). List with status. Customers dismiss banners ("Dismiss" stored per person). Empty: "No announcements."

### S9.11 `/admin/settings` (Platform sections)

Launch (Preview access list: emails or invite links; Open to the public), Service & legal (names, addresses, the legal editor and the operator checklist from `accounts-8.md` §10.9), Payments (provider, keys with Test, tax display, refund window), Credits, Safety (prompt and output checkers with Test, hash matcher, C2PA certificate upload, badge), Abuse (guards and limits), Storage & backups, Email & DNS (SPF, DKIM, DMARC checks per provider with copyable records and "Check").

## S10. Platform setup steps [acc-37, acc-40, acc-44, acc-49, acc-55]

- **`/setup/credits`:** value $0.01, markup 50%, GPU $2.16 an hour, unknown prices off; a live table: FLUX.2 [pro] 1 MP $0.03 → 4.5 credits; Kling 3.0 5 s 1080p $0.62 → 93; 60 s of GPU → 5.4.
- **`/setup/plans`:** Recommended / Free only / Start empty, with the editable table of §10.2.
- **`/setup/payments`:** None / Stripe / Stripe Managed Payments (test mode first); key field with Connect; "Create products and prices" (sync); webhook created automatically or the `stripe listen --forward-to <site>/api/billing/stripe/webhook` command; tax registration note.
- **`/setup/safety`:** prompt checker (Llama Guard on Ollama, HTTP, or off with a red note "Required before opening to the public"), output checker per engine (fal or local HTTP; Test), hash matching (with the line "Recommended. Required by law in some places once you know of a match."), Content Credentials (self-signed until you upload a certificate), badge on Free.
- **`/setup/storage`:** Local / S3-compatible (endpoint, bucket, keys, Test); nightly snapshots (keep 7); a copyable `litestream.yml`.

## S11. Routes added to the layout checks

`tests/e2e/_routes.mjs` gains `AUTH_ROUTES` and per-role lists; `no-horizontal-scroll` runs each list at 1440 and 390 px in light and dark under its role (Just me, Studio owner, Studio member, Platform signed out, Platform customer, Platform admin):

- **Signed out:** `/setup`, `/setup/start`, `/setup/account`, `/setup/address`, `/setup/studio`, `/setup/service`, `/setup/join`, `/setup/keys`, `/setup/email`, `/setup/sign-in`, `/setup/teams`, `/setup/invite`, `/setup/review`, `/setup/restore`, `/login`, `/login/sso`, `/register`, `/verify`, `/reset`, `/recover`, `/invite/<sample>`, `/two-step`, `/welcome`, `/pricing`, `/coming-soon`, `/legal/terms`, `/report`, `/takedown`, `/appeal`.
- **Any signed-in person:** `/settings/account`, `/settings/usage`, `/settings/privacy`, `/settings/account/connect-cli`, `/teams`, `/teams/<slug>`, `/teams/<slug>/settings`, `/approvals`, `/redeem`, `/settings/billing`, `/billing/success`, `/account/restore`, `/two-step/setup`, `/terms-update`.
- **Admins:** `/settings/access`, `/settings/backup`, `/admin`, `/admin/people`, `/admin/people/<id>`, `/admin/teams`, `/admin/usage`, `/admin/gpu`, `/admin/security`, `/admin/sso`, `/admin/sso/<id>`, `/admin/provisioning`, `/admin/domains`, `/admin/seats`, `/admin/audit`, `/admin/data`, `/admin/plans`, `/admin/plans/<id>`, `/admin/credits`, `/admin/models`, `/admin/codes`, `/admin/payments`, `/admin/moderation`, `/admin/bans`, `/admin/announcements`, `/admin/analytics`, `/admin/health`, `/admin/settings`.
- **Overlays checked at 390 px:** the account menu with 10 teams, the Inbox, the two-step setup dialog, the change-plan sheet, the share dialog, the create-team dialog.

## S12. Email templates

Every template has a plain-text part and an HTML part that reads well in light and dark clients; links are built from the site address, never the request `Host`; transactional mail and announcements use separate streams; names are escaped and URLs never come from user input.

| Template | Subject | Body (short) |
|---|---|---|
| Verification code | "Your {service} code: 482193" | "Use this code to finish signing up: 482193. It expires in 10 minutes. If you didn't ask for it, ignore this email." |
| Reset code | "Reset your {service} password" | "Use this code to choose a new password: 482193. It expires in 10 minutes. Your two-step sign-in stays on." |
| Reset link (admin-made) | "{admin} sent you a password reset" | "Open this link to choose a new password: {link}. It works once, for 60 minutes. Your other devices will be signed out." |
| Invite | "{inviter} invited you to {team}" | "Join {team} on {service} as an {role}. The invite expires in 72 hours: {link}" |
| Approved | "Your {service} account is ready" | "{admin} approved your account. Sign in: {link}" |
| Shared with you | "{name} shared {item} with you" | "Open it: {link}" |
| Limit request | "{name} asks for more this month" | "{name} asks for ${amount} more: '{note}'. Decide: {link}" |
| Sign-up on an existing account | "Someone tried to sign up with your email" | "If it was you, sign in instead: {link}. If not, you can ignore this." |
| Notice (admin action) | "Your {service} account was changed" | "{admin} {action} on {date}. If you didn't expect this, contact {contact}." |
| Recovery used | "Your {service} password was changed with a recovery code" | "Someone with access to the server ran fuobe recover and set a new password on {date}. Every device was signed out." |
| Two-step changed | "Two-step sign-in was {turned on/off}" | "This happened on {date} from {device}. If it wasn't you, reset your password." |
| New sign-in | "New sign-in to {service}" | "{device} signed in on {date} from {place or IP}. Not you? Sign out everywhere: {link}" |
| Approval decided | "Your runs were {approved/declined}" | "{approver}: {note}. Open: {link}" |
| Export ready | "Your {service} data is ready" | "Download it before {date}: {link}" |
| Deletion scheduled | "Your {service} account will be deleted on {date}" | "Sign in before then to cancel: {link}" |
| Budget alert | "Brand team has used 80% of this month's limit" | "≈ $400 of $500. See usage: {link}" |
| Monthly report | "{studio} in October: ≈ $1,240 spent" | Totals by team and person, link to the report |
| Receipt and plan change (Platform) | "You're on Pro" / "Your plan changes on {date}" | Amount, credits granted, renewal date, invoice link |
| Payment failed (Platform) | "Your payment didn't go through" | "Update your payment method by {date} to keep Pro: {link}" |
| Moderation decision (Platform) | "We removed something you made" | The item, the rule, the statement of reasons, "Appeal until {date}: {link}" |
| Takedown received (Platform) | "We received your request" | "We'll decide by {deadline}. Case {id}." |
| Announcement (Platform, broadcast) | Operator's subject | Operator's body; `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) and a visible unsubscribe link |
