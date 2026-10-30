# Public sign-up and guest browsing

A Fuobe studio with a password can open itself a little to the public: signed-out visitors (guests)
browse it read-only, and anyone can make a free account. It is off by default, so a self-hosted
studio behaves as before: every page and API call needs the install password or an API token.

## Turning it on

Public sign-up works only on a studio that has a password (`FUOBE_PASSWORD` or **Settings →
Security**). Then it is on when one of these is true:

- `FUOBE_PUBLIC_SIGNUP=1` is set on the server. `FUOBE_PUBLIC_SIGNUP=0` keeps it off, whatever
  Settings says. While the variable is set, the Settings switch can't change it.
- The owner turns on **Settings → Security → Public sign-up**.
- The request is for `fuobe.com` or `www.fuobe.com` (the public demo), the server lists that name in
  `FUOBE_ALLOWED_ORIGINS`, and `FUOBE_PUBLIC_SIGNUP` is not `0`. The `Host` header comes from the
  client, so a self-hosted studio that someone reaches by its IP address can't be opened with
  `Host: fuobe.com`.

Turning it off signs out every account at once, and guests are sent to sign in again.

## Guests

A guest can open every page: galleries, presets, the studios, Layers, Cinema, Image to 3D and
Settings, read-only. The pages get the catalog and status reads they need (`/api/status`,
`/api/models`, `/api/search-index`, `/api/comfyui`, `/api/settings/models`, curated moodboards,
built-in skills). The owner's library stays private: the lists come back empty, and other reads of
it (files, uploads, projects, settings values, tokens) answer 401 "Sign up to see your library".

Every change a guest sends (generate, upload, save a setting, create a project…) answers 401. The
studio shows a "Create a free account to run this" card with **Sign up** and **Log in**. Price
checks (the estimate routes, and `?preview=1` on the run routes that support it) stay open, so the
studios can show prices.

## Accounts

- Sign up at `/login?signup=1` (`POST /api/auth/signup` with `{ "email", "password" }`). The
  password needs at least 8 characters. There is no email verification.
- Log in at `/login` (`POST /api/auth/login` with `{ "email", "password" }`). The install password
  still works as before: `POST /api/auth/login` with `{ "password" }`, or **Studio owner** on the
  login page.
- Accounts are stored in `auth.json` in the data folder: the email in lower case, a salted scrypt
  hash of the password (the same scheme as the install password), and the creation time.
- Sign-up and log-in attempts are rate limited per visitor (set `FUOBE_TRUST_PROXY=1` behind a
  reverse proxy, so that each visitor gets their own limit).

An account is signed in, but it sees the owner's studio as a guest does:

- **The owner's library stays the owner's.** An account opens every page and the catalog, but the
  owner's results, files, uploads, folders, shares, projects (Layers, Cinema, Canvas, storyboards,
  elements…) and Assist threads are hidden: the lists come back empty, and other reads answer 403.
  Every change to them (create, rename, move, share, delete, upload) answers 403 with
  `code: "library"`. Accounts have only their own runs (below), no uploads or projects yet.
- **Settings, keys and tokens are the owner's.** Changing settings or model switches, the password,
  API tokens, Public sign-up, LoRA downloads, Assist connectors and the MCP endpoint answer 403 for
  an account.
- **Accounts never run on the owner's keys or GPU.** An account runs only on its own ComfyUI (see
  [Your GPU](#your-gpu)). Without one, anything that would reach a model (a generation, an AI
  helper, a retry) answers 403 with `code: "connect-gpu"`, and the studio shows a "Connect your GPU
  to run this" card.
- **Its own runs are its own.** The runs an account starts on its GPU appear in its own lists
  (`GET /api/generations`), and it can open, cancel and delete them and download their files. They
  stay out of the owner's lists, and no other account can open them. The live-updates stream isn't
  sent to accounts: their studios poll instead.

## Managing accounts

The owner sees everyone who signed up in **Settings → Accounts**: email, when the account was
created, its last log-in, whether its own GPU is connected, and the total. The owner can switch an
account off (it is signed out at once and can't log in) or delete it, and export the list as CSV.
The API is `GET /api/admin/accounts` (`?format=csv` for the file), `PATCH /api/admin/accounts/<id>`
with `{ "disabled": true | false }`, and `DELETE /api/admin/accounts/<id>`, for the owner only.

An account can delete itself: `DELETE /api/auth/me` with `{ "password" }`.

## Your GPU

An account connects its own ComfyUI in **Settings → Your GPU**, or from the "Connect your GPU" card.
The studio's server calls that ComfyUI, so it must be reachable from the internet. Put a tunnel in
front of a local ComfyUI and paste the https address it prints:

```bash
cloudflared tunnel --url http://localhost:8188   # or: ngrok http 8188
```

- **Finding ComfyUI.** The page looks for a ComfyUI on the visitor's own computer, from the browser
  (the server can't see that computer). It tries `http://127.0.0.1` on ports 8188, 8000 (ComfyUI
  Desktop), 8189, 8190 and 8288. When ComfyUI answers, the page names the GPU and its VRAM and shows
  the tunnel command. When a port answers but the browser can't read it, ComfyUI was started
  without CORS: the page shows the flag to add, `--enable-cors-header https://fuobe.com`. Chrome
  may ask to let the site reach devices on the local network. When nothing answers, the visitor
  can enter a port or an address. A local address is used only by the browser and is never sent to
  the server.
- **Saving.** `PUT /api/account/gpu` with `{ "url", "token"? }` checks the address and asks that
  ComfyUI for `/system_stats` (`?test=1` checks without saving). `DELETE` disconnects. The address
  and the optional token (sent as `Authorization: Bearer`) are stored with the account in
  `auth.json`, never as the studio's ComfyUI setting.
- **Server-side requests.** Addresses on the server itself, on private networks or link-local
  addresses are refused. The check runs again on the address each connection actually uses, so a
  name that is later pointed at the server can't reach the studio's own ComfyUI. The studio's own
  ComfyUI address is refused too. `FUOBE_ALLOW_PRIVATE_URLS=1` allows private addresses, for a LAN
  install.
- **Runs.** The Image, Video and Audio studios' generations (`POST /api/generations`) run on the
  account's ComfyUI with the open-source engine. Polls, uploads, outputs and cancels go there too,
  and nothing falls back to the studio's own providers. If the account's ComfyUI can't be reached,
  the run fails and says so. A cloud model, an AI helper or the studio's local LLM is refused. Other
  tools (Canvas, Cinema, Assist…) answer 403 with `code: "own-gpu-tool"`, because they plan with
  the studio's own AI helpers. A LoRA must already be on the account's ComfyUI: the studio
  downloads LoRAs only into its own folder. Accounts can't upload files yet, so runs that start
  from a picture or a clip aren't available to them.
- **What a visitor sees.** For a guest or an account, `GET /api/status` describes its own GPU
  (`viewer`), with the open engine and no Demo mode. It says nothing about the studio's own
  ComfyUI, providers, keys or local AI servers. The sidebar shows **Your GPU · Connect** (a guest
  signs up first), or the account's ComfyUI as online or offline with its GPU and VRAM.
  `GET /api/models` lists the open-source models for a visitor, and the studios price a visitor's
  run as it would go on its own GPU. The studio's own settings page isn't shown to visitors.

`GET /api/auth/me` (open to everyone) says who is looking: `{ signedIn, owner, publicSignup,
account? }`.

The rules are in `src/lib/guest-access.ts` (which paths guests and accounts may use) and
`src/proxy.ts` (where they are applied). Your GPU is `src/server/account-gpu.ts`, `onOwnGpu` in
`src/server/providers/comfyui.ts` and `accountRun` in `src/server/generations.ts`. The tests are in
`tests/public-signup.test.ts`, `tests/accounts-admin.test.ts` and `tests/account-gpu.test.ts`.
