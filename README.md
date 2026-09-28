<div align="center">

# KanhaGen

**A full-stack AI image generation & chat workspace.**

Write a prompt, upload a photo, or batch-generate — everything lands in a personal, shareable gallery.

[![Live](https://img.shields.io/badge/live-kanhagen.vercel.app-6366f1?style=for-the-badge)](https://kanhagen.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.2-000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2.4-087ea4?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/license-MIT-8b5cf6?style=for-the-badge)](#license)

</div>

---

## Table of Contents

- [Highlights](#highlights)
- [Screens](#screens)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Features](#features)
- [Security](#security)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Testing](#testing)
- [Deploy](#deploy)
- [License](#license)

---

## Highlights

<table>
<tr>
<td width="50%" valign="top">

**🧠 One prompt, many engines**

A request is classified as image, vision, text or "similar", then routed down a fallback chain — Pollinations → Hugging Face → Gemini → Together → AI Horde. A circuit breaker skips providers that are already failing instead of burning your timeout.

</td>
<td width="50%" valign="top">

**👁️ Vision & OCR**

Upload any image. Gemini vision describes it or answers questions about it; if Gemini is unavailable, OCR.space extracts the text instead. Both paths are saved as chat history.

</td>
</tr>
<tr>
<td valign="top">

**🔐 Real account security**

bcrypt password hashing, HS256 JWT sessions in httpOnly cookies, Cloudflare Turnstile on every auth mutation, single-use password-reset tokens, and a full anti-enumeration policy.

</td>
<td valign="top">

**⚡ Bounded infrastructure**

No unbounded Maps. LRU caches, a sliding-window rate limiter and a Bloom filter keep memory flat under load, with explicit complexity guarantees documented in the code.

</td>
</tr>
</table>

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16.2.2 (App Router, Route Handlers) · React 19.2.4 |
| **Language** | TypeScript 5 (strict) |
| **Styling** | Tailwind CSS v4 (`@theme` tokens) · shadcn/ui · `@base-ui/react` |
| **Animation** | Motion (Framer Motion) · `tw-animate-css` |
| **Database** | MongoDB (Atlas) via the official `mongodb` 7.x driver |
| **Auth** | `jose` (HS256 JWT) · `bcryptjs` (10 rounds) · Cloudflare Turnstile |
| **AI — text** | Gemini streaming (SSE) · Pollinations fallback |
| **AI — image** | Pollinations · Hugging Face · Gemini · Together AI · AI Horde |
| **AI — vision** | Gemini vision · OCR.space fallback |
| **Media** | `sharp` (watermark compositing, PNG re-encode) |
| **Email** | Brevo → Resend → dev preview |
| **Testing** | Vitest (10 suites) · ESLint · `tsc --noEmit` |

---

## Architecture

```
app/
├── layout.tsx                 Root layout · fonts · theme · toaster
├── page.tsx                   Workspace (chat stream + sidebar)
├── about/                     Public self-documenting page — no login needed
├── explore/                   Public gallery · search · sort
├── history/                   Personal library · lightbox
├── settings/                  Preferences
├── login/ · signup/           Auth (Turnstile-protected)
├── forgot-password/           Request a reset link
├── reset-password/            Consume a reset token
└── api/                       20 route files → 26 endpoints

components/                    19 components
lib/                           26 modules
test/                          10 Vitest suites
```

### How a request flows

```
  prompt entered
       │
       ▼
  ┌─────────────┐   httpOnly JWT cookie
  │  Route      │──────────────────────────┐
  │  Handler    │                          │
  └─────┬───────┘                          ▼
        │                          ┌───────────────┐
        ▼                          │  Turnstile    │  ← login / signup / forgot
  ┌───────────────┐                │  verification  │
  │ charge daily  │                └───────────────┘
  │ Mongo credit  │
  └───────┬───────┘
          ▼
  ┌───────────────┐
  │ classify      │  image · vision · text · similar
  │ intent        │
  └───────┬───────┘
          ▼
  ┌───────────────┐
  │ provider chain│  circuit breaker skips dead providers
  └───────┬───────┘
          ▼
  ┌───────────────┐
  │ watermark     │  sharp · KanhaGen · bottom-right
  │ + LRU cache   │
  └───────┬───────┘
          ▼
   persist to image_history
```

---

## Features

### 🎨 Image generation
- Staged "Generating…" progress UI
- Width / height / seed / model controls
- Style presets + prompt enhancement
- **KanhaGen** watermark composited onto every image (`sharp`)
- Results cached in a 200-entry, 30-minute LRU

### 💬 AI chat
- Server-Sent Events streaming, delta by delta
- Typewriter reveal with blinking cursor
- Rendered Markdown — headings, lists, code
- Model picker: Auto · Gemini · Pollinations
- Cross-chat memory — tell it your name once, it remembers

### 👁️ Vision / OCR
- Upload any image
- Gemini vision understands it
- OCR.space fallback extracts text when vision is unavailable

### 🔁 Variations & batch
- One-click "Similar"
- Up to 6 seed variations
- 1–8 images in parallel

### 🗂️ Library & sharing
- Pin · rename · delete
- Pinned items float to the top
- Resume any past conversation
- Public Explore gallery with search + trending

### 👤 Accounts
- Email + password signup/login
- **Forgot / reset password** over email
- Daily free credits — 5 images + 30 chat asks

### ⌨️ Interface
- Command palette (`Ctrl`/`Cmd` + `K`)
- Dark mode with a flash-free theme script
- Blur-up image placeholders
- Copy & download everywhere
- Fully responsive

---

## Security

Security is enforced **server-side**. The captcha widget is only the client-side gesture.

| Area | Implementation |
|---|---|
| **Password hashing** | bcryptjs, 10 salt rounds. Plaintext is never stored. |
| **Sessions** | HS256 JWT, 7-day expiry, httpOnly + SameSite=Lax + Secure (prod) |
| **Captcha** | Cloudflare Turnstile on login, signup, forgot-password |
| **Captcha binding** | `expectedAction` is hard-bound — a token minted for `signup` cannot be replayed on `login` |
| **Fail-closed** | A missing secret denies every request in production, so a broken integration can never silently allow traffic |
| **Turnstile rejection codes** | Returned as a machine-readable `code` so failures are diagnosable, not mysterious |
| **Reset tokens** | 32 CSPRNG bytes, SHA-256 hashed at rest, 1-hour TTL, single-use, latest-token-only |
| **Anti-enumeration** | Forgot-password always returns an identical response — and sleeps 120 ms on the miss path to flatten timing |
| **Constant-time login** | A dummy bcrypt hash is verified when no user exists, so response time can't reveal valid emails |
| **Ownership** | Every history read / rename / delete filters by `userId` |
| **Image privacy** | Images are **private by default**; the gallery only serves rows explicitly marked `public: true` |
| **Rate limiting** | Sliding window: 20 req/min per user, plus tighter per-IP and per-account limits on auth routes |
| **MIME sniffing** | Magic-byte detection on upload, with `nosniff` and a safe response MIME on the image sink |
| **Input limits** | 2 000-char prompt cap, 10 MB upload cap, bcrypt's 72-byte limit respected |
| **Headers** | Full CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |

> **Note:** reset-password is intentionally *not* captcha-gated — the 256-bit single-use token **is** the authorization.

---

## Getting Started

**Requirements:** Node.js 20+ and a MongoDB database (local or Atlas).

```bash
git clone https://github.com/kanhajatthap/kanhagen.git
cd kanhagen
npm install
```

Create your environment file:

```bash
cp .env.example .env.local
```

Then start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack, hot reload) |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite |
| `npm run clean` | Delete `.next` to reset a corrupt cache |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill it in.

### Core

| Variable | Required | Purpose |
|---|:---:|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `MONGODB_DB` | — | Database name (default `ai_image_generator`) |
| `SESSION_SECRET` | ✅ | HS256 JWT signing key |
| `APP_URL` | — | Canonical base URL for reset links |

### AI providers

| Variable | Required | Purpose |
|---|:---:|---|
| `GEMINI_API_KEY` | ✅ | Gemini text, vision, image, memory extraction |
| `GEMINI_TEXT_MODEL` | — | Text model (default `gemini-3.1-flash-lite`) |
| `GEMINI_VISION_MODEL` | — | Vision model (default `gemini-3.1-flash-lite`) |
| `GEMINI_IMAGE_MODEL` | — | Image model (default `gemini-3.1-flash-image`) |
| `OCR_SPACE_API_KEY` | — | OCR fallback when Gemini vision is unavailable |
| `HF_TOKEN` / `HUGGINGFACE_API_KEY` | — | Hugging Face image generation |
| `TOGETHER_API_KEY` | — | Together AI image generation |
| `HORDE_API_KEY` | — | AI Horde (anonymous by default) |

> Gemini is called over its REST + SSE endpoints with native `fetch`. Pollinations needs no key at all.

### Auth & abuse protection

| Variable | Required | Purpose |
|---|:---:|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ✅ | Turnstile browser site key — **inlined at build time** |
| `TURNSTILE_SECRET_KEY` | ✅ | Turnstile server secret |
| `TURNSTILE_EXPECTED_HOSTNAME` | — | Advisory hostname check (warns, never rejects) |

> ⚠️ `NEXT_PUBLIC_*` values are baked in when you **build**. Adding the env var is not enough — you must redeploy.

### Email

| Variable | Required | Purpose |
|---|:---:|---|
| `BREVO_API_KEY` | — | Brevo API key (preferred transport) |
| `BREVO_FROM_EMAIL` | — | Brevo sender address |
| `BREVO_FROM_NAME` | — | Brevo sender name (default `KanhaGen`) |
| `RESEND_API_KEY` | — | Resend API key (fallback transport) |
| `MAIL_FROM` | — | Resend sender (default `KanhaGen <no-reply@example.com>`) |

Without either transport, local development prints the reset link to the console instead of sending it.

### Quotas

| Variable | Required | Purpose |
|---|:---:|---|
| `FREE_IMAGE_CREDITS` | — | Daily image cap (default `5`) |
| `FREE_TEXT_CREDITS` | — | Daily chat cap (default `30`) |

---

## API Reference

26 endpoints across 20 route files. `🔒` = requires a valid session.

### Auth

| Method | Path | Auth | Description |
|---|---|:---:|---|
| `POST` | `/api/auth/signup` | — | Create an account and sign in |
| `POST` | `/api/auth/login` | — | Email + password login |
| `POST` | `/api/auth/logout` | — | Clear the session cookie |
| `GET` | `/api/auth/me` | — | Current user from the JWT |
| `POST` | `/api/auth/forgot-password` | — | Request a reset link (generic response) |
| `POST` | `/api/auth/reset-password` | — | Consume a reset token |

### Generation

| Method | Path | Auth | Description |
|---|---|:---:|---|
| `POST` | `/api/chat` | 🔒 | Multiplexing endpoint: image · text · vision · similar |
| `POST` | `/api/generate` | 🔒 | Generate an image or text with settings |
| `GET` | `/api/generate` | — | Health check + configured providers |
| `POST` | `/api/text` | 🔒 | Text chat (SSE stream or JSON) |
| `POST` | `/api/vision` | 🔒 | Understand an uploaded image |
| `POST` | `/api/variations` | 🔒 | N variations with distinct seeds |
| `POST` | `/api/batch-generate` | 🔒 | 1–8 images in parallel |

### Data

| Method | Path | Auth | Description |
|---|---|:---:|---|
| `GET` | `/api/quota` | 🔒 | Credits remaining + next reset time |
| `GET` | `/api/history` | 🔒 | Paginated history, pinned first |
| `POST` | `/api/history` | 🔒 | Manually save an image |
| `PATCH` | `/api/history` | 🔒 | Rename or pin |
| `DELETE` | `/api/history` | 🔒 | Delete an item or a conversation |
| `GET` | `/api/history/[id]` | 🔒 | Single conversation detail |
| `GET` | `/api/history/[id]/image` | — | Raw image bytes (owner, or `public === true`) |
| `GET` | `/api/explore` | — | Public gallery: search · sort · paginate |
| `GET` | `/api/prompt-history` | — | Recent prompts for autocomplete |
| `GET` `POST` `DELETE` | `/api/memory` | 🔒 | Cross-chat memory facts |
| `GET` | `/api/test` | — | Health check (404 in production) |

---

## Data Model

Four MongoDB collections.

| Collection | Stores |
|---|---|
| `users` | Accounts, bcrypt hashes, cross-chat memory |
| `image_history` | Every generation and conversation — base64 images, text, batch results, messages |
| `quotas` | Daily credit counters, one document per user per UTC day |
| `password_resets` | Hashed reset tokens with TTL and single-use state |

---

## Testing

```bash
npm test          # 10 Vitest suites
npm run lint      # ESLint
npx tsc --noEmit  # type check
```

The suite covers the parts where a silent bug is expensive: the LRU cache, the sliding-window rate limiter, the Bloom filter, quota accounting, the password-reset token lifecycle, mailer transport selection, Turnstile verification, and upload validation.

---

## Deploy

The app is configured for Vercel.

1. Import the repository.
2. Add the environment variables from the table above.
3. Deploy.

**After adding a `NEXT_PUBLIC_*` variable, redeploy** — client bundles are built once, so a new build is required for the value to reach the browser.

---

## License

MIT © KanhaGen
