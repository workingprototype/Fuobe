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
  still works as before: `POST /api/auth/login` with `{ "password" }`, or the owner's sign-in at
  `/login?owner=1`. The login page links to it only in development, so a public site doesn't
  advertise it.
- Accounts are stored in `auth.json` in the data folder: the email in lower case, a salted scrypt
  hash of the password (the same scheme as the install password), and the creation time.
- Sign-up and log-in attempts are rate limited per visitor (set `FUOBE_TRUST_PROXY=1` behind a
  reverse proxy, so that each visitor gets their own limit).

An account is signed in, but it sees the owner's studio as a guest does:

- **The owner's library stays the owner's.** An account opens every page and the catalog, but the
  owner's results, files, uploads, folders, shares, projects (Layers, Cinema, Canvas, storyboards,
  elements…) and Assist threads are hidden: the lists come back empty, and other reads answer 403.
  Every change to them (create, rename, move, share, delete) answers 403 with `code: "library"`.
  Accounts have their own uploads and runs (below), but no projects yet.
- **Settings, keys and tokens are the owner's.** Changing settings or model switches, the password,
  API tokens, Public sign-up, LoRA downloads, Assist connectors and the MCP endpoint answer 403 for
  an account.
- **Accounts never run on the owner's keys or GPU.** An account runs only on its own ComfyUI (see
  [Your GPU](#your-gpu)). Without one, anything that would reach a model (a generation, an AI
  helper, a retry) answers 403 with `code: "connect-gpu"`, and the studio shows a "Connect your GPU
  to run this" card.
- **Its own runs are its own.** The runs an account starts on its GPU appear in its own lists
  (`GET /api/generations`), and it can open, cancel and delete them and download their files. They
  stay out of the owner's lists, and no other account can open them. An account's delete is for
  good (it has no Trash), so its space comes back at once. The live-updates stream isn't sent to
  accounts: their studios poll instead.
- **Its own uploads are its own.** Only the account that uploaded a file can open it or use it in a
  run. See [Uploads](#uploads).

## Managing accounts

The owner sees everyone who signed up in **Settings → Accounts**: email, when the account was
created, its last log-in, whether its own GPU is connected, and the total. The owner can switch an
account off (it is signed out at once and can't log in) or delete it, and export the list as CSV.
The API is `GET /api/admin/accounts` (`?format=csv` for the file), `PATCH /api/admin/accounts/<id>`
with `{ "disabled": true | false }`, and `DELETE /api/admin/accounts/<id>`, for the owner only.

An account can delete itself: `DELETE /api/auth/me` with `{ "password" }`. When an account is
deleted (by itself or by the owner), its runs are stopped and removed, and its uploads and results
are deleted with it.

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
  ComfyUI address is refused too, and so are IPv6 addresses that wrap an IPv4 address.
  `FUOBE_ALLOW_PRIVATE_URLS=1` allows private addresses, for a LAN install, but never the server's
  own addresses. Address checks are limited to 10 a minute.
- **Runs.** Everything that runs through `POST /api/generations` runs on the account's ComfyUI
  with the open-source engine: the Image, Video and Audio studios (their input modes too: edit,
  inpaint, extend, lipsync, reframe, upscale, image to video…), every camera motion and effect,
  and the apps that take a picture, a clip or a sound. Their chained steps (multi-shot films,
  Frames mode, Extend, text to 3D, relit effects) run there too, as the account's own. Polls,
  uploads, outputs and cancels go there, and nothing falls back to the studio's own providers. If
  the account's ComfyUI can't be reached, the run fails and says so. A cloud model, an AI helper or
  the studio's local LLM is refused; "Enhance prompt" uses Fuobe's offline wording. Other tools
  (Canvas, Cinema, Shorts, Assist, Marketing…) answer 403 with `code: "own-gpu-tool"`, because they
  plan with the studio's own AI helpers or keep projects of their own.
- **Files a run takes.** A run on your GPU takes only files you uploaded here, or your own results.
  A link or a `data:` URI answers 400 with `code: "input-not-allowed"`, someone else's file 403
  (`input-not-yours`), and a file that has expired 404 (`input-gone`, "That file has expired.
  Upload it again."). The server never fetches a link for an account.
- **LoRAs and model files.** The server never downloads anything onto your machine. A LoRA a run
  adds (a camera motion's, an effect's, a look's) must already be in your ComfyUI's `models/loras`
  folder. When one is missing, the run answers 409 with `code: "comfy_missing_model"` and a `fix`
  that lists each file, the folder it goes in and where to download it ("Your ComfyUI doesn't have
  2 LoRA files this needs. Download each one into ComfyUI/models/loras, keep the file name, then
  press Generate again."). The same check runs again when the run is handed to your ComfyUI. A
  checkpoint or encoder your ComfyUI lacks is named by ComfyUI's own answer.
- **Limits.** Up to 4 runs at once and 60 an hour; a run makes up to 4 results. A run waits up to
  30 minutes in your ComfyUI's queue and may run for 45. Your ComfyUI's answers have a deadline and
  a size cap (a result up to 1 GB in 15 minutes; 16 results a job at most). Image to 3D gets the
  web model, without the server's turntable: the 3D page records one in your browser.
- **What a visitor sees.** For a guest or an account, `GET /api/status` describes its own GPU
  (`viewer`), with the open engine and no Demo mode. It says nothing about the studio's own
  ComfyUI, providers, keys or local AI servers. The sidebar shows **Your GPU · Connect** (a guest
  signs up first), or the account's ComfyUI as online or offline with its GPU and VRAM.
  `GET /api/models` lists the open-source models for a visitor, and the studios price a visitor's
  run as it would go on its own GPU. The studio's own settings page isn't shown to visitors.

## Uploads

An account with its own ComfyUI connected can upload files (`POST /api/uploads`, the file as the
request body with its type in `Content-Type` and its name in `X-File-Name`; an older page's
multipart form works up to 26 MB). Without a connected GPU it answers 403 with
`code: "connect-gpu"`, and a guest gets 401 with the sign-up card.

| What | Types | Largest |
|---|---|---|
| Pictures | PNG, JPEG, WebP | 25 MB and 40 megapixels |
| Sound | MP3, WAV, OGG, FLAC, M4A, WebM | 50 MB |
| Clips | MP4, MOV, WebM, MKV, AVI | 95 MB (ComfyUI takes up to 100 MB unless started with more) |

- The type is read from the file's first bytes. A file that isn't one of these answers 415.
- `Content-Length` is required (411), and a file over its size answers 413 before it is read.
- An account keeps up to 1 GB of uploads and 3 GB of files in all (uploads and results). Past that,
  uploads and runs answer 413: delete some runs to make room.
- Up to 60 uploads an hour, 300 a day and 2 at once (429 with `Retry-After`).
- **How long files stay.** Uploads are removed after 14 days, even when a run still uses them.
  Runs and their results are removed after 30 days. Everything goes at once when the account is
  deleted.

`GET /api/auth/me` (open to everyone) says who is looking: `{ signedIn, owner, publicSignup,
account? }`.

The rules are in `src/lib/guest-access.ts` (which paths guests and accounts may use) and
`src/proxy.ts` (where they are applied). Your GPU is `src/server/account-gpu.ts`, `onOwnGpu` in
`src/server/providers/comfyui.ts` and `accountRun` in `src/server/generations.ts`; what an account's
work may read is `src/server/tenant.ts`. Uploads are `src/app/api/uploads/route.ts` (which makes the
proxy's checks itself, `src/server/direct-gate.ts`), the limits are in `src/server/account-files.ts`
and the clean-up in `src/server/account-sweep.ts`. The tests are in `tests/public-signup.test.ts`,
`tests/accounts-admin.test.ts`, `tests/account-gpu.test.ts` and the `tests/account-*.test.ts` files.
