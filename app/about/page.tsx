"use client";

import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowRight,
  Binary,
  Boxes,
  Braces,
  CheckCircle2,
  Coins,
  Copy,
  Cpu,
  Database,
  DatabaseZap,
  EyeOff,
  FileText,
  FolderTree,
  Gauge,
  GalleryVerticalEnd,
  Globe,
  Hash,
  Image,
  ImageUp,
  KeyRound,
  Layers,
  LayoutGrid,
  Lock,
  Mail,
  MessageSquare,
  Moon,
  Palette,
  RefreshCcw,
  Rocket,
  ScanText,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  TriangleAlert,
  Users,
  Wand2,
  Waypoints,
  Zap,
} from "lucide-react";

const NAV = [
  "Overview",
  "Tech Stack",
  "Workflow",
  "Architecture",
  "Data Model",
  "API Endpoints",
  "Security",
  "Algorithms & Data Structures",
  "Features",
  "UI & UX",
  "Setup",
];

const STATS = [
  { icon: Rocket, label: "Next.js", value: "16.2.2" },
  { icon: Braces, label: "React", value: "19.2.4" },
  { icon: Server, label: "Endpoints", value: "26" },
  { icon: Boxes, label: "Components", value: "19" },
  { icon: Database, label: "Collections", value: "4" },
  { icon: Cpu, label: "AI Engine", value: "5 providers" },
];

const STACK = [
  {
    icon: Boxes,
    title: "Framework",
    accent: "from-indigo-500 to-purple-600",
    items: [
      { name: "Next.js 16.2.2", detail: "App Router · Route Handlers · SSR/CSR" },
      { name: "React 19.2.4", detail: "Server + client components, hooks" },
      { name: "TypeScript 5", detail: "Strict typing across the entire app" },
      { name: "Turbopack", detail: "Next.js native bundler / dev server" },
      { name: "next/font", detail: "Geist · Geist Mono · Space Grotesk" },
    ],
  },
  {
    icon: Palette,
    title: "Styling & UI",
    accent: "from-fuchsia-500 to-pink-500",
    items: [
      { name: "Tailwind CSS v4", detail: "Utility-first, @theme tokens, dark variant" },
      { name: "shadcn/ui", detail: "base-nova style, headless primitives" },
      { name: "@base-ui/react", detail: "Accessible UI primitives" },
      { name: "lucide-react", detail: "Consistent icon set" },
      { name: "tw-animate-css", detail: "Animation utilities" },
    ],
  },
  {
    icon: Zap,
    title: "Motion & Feedback",
    accent: "from-amber-500 to-orange-600",
    items: [
      { name: "motion (Framer Motion)", detail: "Page transitions, entrances, micro-animations" },
      { name: "sonner", detail: "Toast notifications, rich colors" },
      { name: "class-variance-authority", detail: "Reusable variant styling" },
      { name: "clsx + tailwind-merge", detail: "Smart class merging" },
    ],
  },
  {
    icon: Server,
    title: "Backend & Data",
    accent: "from-emerald-500 to-teal-600",
    items: [
      { name: "MongoDB Driver 7.x", detail: "Official driver, cached connection" },
      { name: "MongoDB Atlas", detail: "Managed cloud database cluster" },
      { name: "jose (JWT)", detail: "HS256 session signing & verification" },
      { name: "bcryptjs", detail: "Passwords hashed with 10 salt rounds" },
    ],
  },
  {
    icon: ShieldCheck,
    title: "Auth & Abuse Protection",
    accent: "from-cyan-500 to-blue-600",
    items: [
      { name: "Cloudflare Turnstile", detail: "Widget on login · signup · forgot-password" },
      { name: "lib/turnstile.ts", detail: "Server-side siteverify, action-bound, fail-closed in prod" },
      { name: "lib/captchaMessage.ts", detail: "Maps siteverify error codes to actionable copy" },
      { name: "lib/passwordReset.ts", detail: "Single-use SHA-256 reset tokens, 1-hour TTL" },
      { name: "Brevo → Resend", detail: "Reset email transport chain + dev preview" },
    ],
  },
  {
    icon: Cpu,
    title: "AI & Media",
    accent: "from-sky-500 to-cyan-600",
    items: [
      { name: "Gemini API", detail: "text streaming · image gen · vision (understands uploaded images)" },
      { name: "Pollinations AI", detail: "image + text fallback endpoints · 30s budget" },
      { name: "OCR.space", detail: "Text-extraction fallback when Gemini vision is unavailable" },
      { name: "sharp", detail: "Image processing + SVG watermark overlay" },
    ],
  },
  {
    icon: MessageSquare,
    title: "Chat & Content",
    accent: "from-violet-500 to-indigo-600",
    items: [
      { name: "Server-Sent Events", detail: "TextEncoder stream to the client, delta by delta" },
      { name: "react-markdown + remark-gfm", detail: "Renders assistant Markdown (headings, lists, code)" },
      { name: "Typewriter effect", detail: "Interval reveal with blinking cursor, turbo-finish" },
    ],
  },
  {
    icon: Gauge,
    title: "Performance",
    accent: "from-rose-500 to-red-500",
    items: [
      { name: "LRU image cache", detail: "Recency eviction, 30-min TTL, max 200 entries" },
      { name: "Sliding-window rate limiter", detail: "20 requests / minute per user, LRU-evicted buckets" },
      { name: "Provider circuit breaker", detail: "Pollinations: 2 failures → 10-min cooldown" },
      { name: "Blur-up placeholders", detail: "Lazy image loading + shimmer" },
      { name: "Daily free credits", detail: "5 images + 30 chat asks / day, MongoDB-backed, reset 5:30 AM IST" },
    ],
  },
];

const FLOW = [
  {
    icon: MessageSquare,
    title: "1 · Compose & submit",
    detail: "User types a prompt (or uploads an image) in the chat box and hits send.",
  },
  {
    icon: ShieldCheck,
    title: "2 · Authenticate",
    detail: "Every request verifies the httpOnly JWT session cookie (jose HS256, 7-day expiry).",
  },
  {
    icon: Coins,
    title: "3 · Charge daily credit",
    detail: "One image credit — or one chat credit for text/vision — is spent from the user's daily bucket (stored in MongoDB). When it's empty the API replies 429 with the exact refill time (5:30 AM IST).",
  },
  {
    icon: Waypoints,
    title: "4 · Route the intent",
    detail: "The server detects the request type: image keywords → image, uploaded image → vision (Gemini first, OCR fallback), 'similar' → variations, otherwise → text.",
  },
  {
    icon: Cpu,
    title: "5 · Call the provider chain",
    detail: "Text: Gemini streams via SSE (with a Pollinations fallback that detects provider errors). Image: Pollinations → Gemini → Hugging Face → Together → Horde with a circuit breaker.",
  },
  {
    icon: Database,
    title: "6 · Persist",
    detail: "Result is base64-stored in MongoDB image_history (with prompt, model, mimeType, seed, messages).",
  },
  {
    icon: Sparkles,
    title: "7 · Render",
    detail: "Text types out with a blinking cursor then swaps to rendered Markdown; images fade in with a blur-up, both with copy/download actions.",
  },
];

const WORKFLOW_PIPELINE = [
  { name: "Intake", detail: "Client POST → Route Handler → session verify" },
  { name: "Quota", detail: "Spend Mongo-backed daily credit (5 img / 30 chat), reset 5:30 AM IST" },
  { name: "Intent", detail: "isImageGenerationRequest() keyword classifier" },
  { name: "Generate", detail: "Gemini → Pollinations chain, circuit breaker" },
  { name: "Enrich", detail: "Watermark (sharp), LRU cache, metadata" },
  { name: "Store", detail: "image_history insert/update in MongoDB" },
  { name: "Serve", detail: "data:URL or /api/history/:id/image bytes" },
];

const DATABASE = [
  {
    name: "users",
    icon: Users,
    note: "Accounts & credentials",
    indexes: "Indexes: { email: 1 } unique",
    fields: [
      { field: "name", type: "string", desc: "Display name" },
      { field: "email", type: "string", desc: "Unique index, lowercase" },
      { field: "passwordHash", type: "string", desc: "bcrypt, 10 rounds" },
      { field: "memory", type: "string[]", desc: "Cross-chat assistant memory (name, facts)" },
      { field: "createdAt / updatedAt", type: "date", desc: "Timestamps" },
    ],
  },
  {
    name: "image_history",
    icon: GalleryVerticalEnd,
    note: "One document per generation / conversation",
    indexes: "Indexes: { userId: 1, createdAt: -1 } · { createdAt: -1 } · { prompt: 'text' }",
    fields: [
      { field: "userId", type: "string", desc: "Owner reference (hex ObjectId string)" },
      { field: "prompt / title", type: "string", desc: "Prompt + optional custom title" },
      { field: "type", type: "string", desc: "image · text · vision · batch" },
      { field: "model / mimeType", type: "string", desc: "e.g. flux, pollinations-text" },
      { field: "imageBase64", type: "string", desc: "Stored image data" },
      { field: "generatedText", type: "string", desc: "Text response payload" },
      { field: "seed / width / height / style", type: "mixed", desc: "Generation settings" },
      { field: "batchResults", type: "array", desc: "Batch variants with seeds" },
      { field: "messages", type: "array", desc: "Conversation thread" },
      { field: "public / pinned", type: "bool", desc: "Opt-in visibility + pin flag" },
      { field: "createdAt / updatedAt", type: "date", desc: "Timestamps" },
    ],
  },
  {
    name: "quotas",
    icon: Coins,
    note: "Daily free credits, one doc per user per UTC day",
    indexes: "Indexes: { userId: 1, day: 1 } unique",
    fields: [
      { field: "userId / day", type: "string", desc: "Owner + period key (e.g. 2026-09-25)" },
      { field: "images", type: "number", desc: "Images used today (5/day cap)" },
      { field: "text", type: "number", desc: "Chat credits used today (30/day cap)" },
    ],
  },
  {
    name: "password_resets",
    icon: KeyRound,
    note: "One-shot reset tokens — only the hash is stored",
    indexes: "Indexes: { tokenHash: 1 } unique · { expiresAt: 1 } TTL 0s · { userId: 1, usedAt: 1 }",
    fields: [
      { field: "userId", type: "string", desc: "Owner reference" },
      { field: "tokenHash", type: "string", desc: "SHA-256 hex of the 32-byte token" },
      { field: "expiresAt", type: "date", desc: "1-hour TTL, Mongo expires the doc" },
      { field: "usedAt", type: "date|null", desc: "Set on consume; null = still claimable" },
      { field: "requestIp", type: "string", desc: "Issuing IP for audit" },
    ],
  },
];

const API = [
  { method: "POST", path: "/api/auth/signup", desc: "Create account, auto-login · captcha · per-IP throttle", auth: false },
  { method: "POST", path: "/api/auth/login", desc: "Login with email + password · captcha · per-IP + per-account throttle", auth: false },
  { method: "POST", path: "/api/auth/logout", desc: "Clear session cookie", auth: false },
  { method: "GET", path: "/api/auth/me", desc: "Return current user from JWT", auth: false },
  { method: "POST", path: "/api/auth/forgot-password", desc: "Request a reset link · captcha · always a generic response", auth: false },
  { method: "POST", path: "/api/auth/reset-password", desc: "Consume a single-use token and set the new password", auth: false },
  { method: "POST", path: "/api/chat", desc: "Main chat: image / text / vision / similar", auth: true },
  { method: "GET", path: "/api/generate", desc: "Health check + list of configured providers", auth: false },
  { method: "POST", path: "/api/generate", desc: "Generate with settings + watermark + cache", auth: true },
  { method: "POST", path: "/api/batch-generate", desc: "Generate 1–8 images in parallel", auth: true },
  { method: "POST", path: "/api/variations", desc: "N variations with distinct seeds (max 6)", auth: true },
  { method: "GET", path: "/api/quota", desc: "Daily credits remaining + next reset time", auth: true },
  { method: "POST", path: "/api/text", desc: "Dedicated chat/text endpoint (SSE or JSON)", auth: true },
  { method: "POST", path: "/api/vision", desc: "Understand an uploaded image (Gemini vision / OCR)", auth: true },
  { method: "GET", path: "/api/explore", desc: "Public gallery: search · sort · paginate", auth: false },
  { method: "GET", path: "/api/history", desc: "List user history (pinned first)", auth: true },
  { method: "POST", path: "/api/history", desc: "Manually save an image", auth: true },
  { method: "PATCH", path: "/api/history", desc: "Rename or pin an item", auth: true },
  { method: "DELETE", path: "/api/history", desc: "Delete an item or a whole conversation", auth: true },
  { method: "GET", path: "/api/history/:id", desc: "Single conversation detail", auth: true },
  { method: "GET", path: "/api/history/:id/image", desc: "Raw image bytes (owner or public) · nosniff", auth: false },
  { method: "GET", path: "/api/prompt-history", desc: "Recent unique prompts (autocomplete)", auth: false },
  { method: "GET", path: "/api/memory", desc: "List cross-chat assistant memory facts", auth: true },
  { method: "POST", path: "/api/memory", desc: "Add a memory fact", auth: true },
  { method: "DELETE", path: "/api/memory", desc: "Remove a memory fact", auth: true },
  { method: "GET", path: "/api/test", desc: "Health check — returns 404 in production", auth: false },
];

const SECURITY = [
  {
    icon: KeyRound,
    title: "Password hashing",
    detail: "bcryptjs with 10 salt rounds. Passwords are never stored in plain text, and inputs respect bcrypt's 72-byte limit.",
  },
  {
    icon: Lock,
    title: "Secure sessions",
    detail: "JWT (HS256, 7-day expiry) in an httpOnly + sameSite lax cookie, secure flag in production.",
  },
  {
    icon: ShieldCheck,
    title: "Cloudflare Turnstile",
    detail: "Server-side siteverify on login, signup and forgot-password. The action is hard-bound, so a token minted for signup cannot be replayed on login.",
  },
  {
    icon: TriangleAlert,
    title: "Fail-closed captcha",
    detail: "If the secret is missing in production every request is denied — a broken integration can never silently allow traffic. Rejections return a machine-readable code, not a mystery 403.",
  },
  {
    icon: Mail,
    title: "Single-use reset tokens",
    detail: "32 CSPRNG bytes, SHA-256 hashed at rest, 1-hour TTL, consumed by one atomic findOneAndUpdate. Issuing a new token burns every previous one.",
  },
  {
    icon: EyeOff,
    title: "Anti-enumeration",
    detail: "Forgot-password returns an identical response whether or not the address exists, sleeps 120 ms on the miss path to flatten timing, and login verifies a dummy hash when no user exists.",
  },
  {
    icon: Users,
    title: "Ownership enforcement",
    detail: "Every history read/rename/delete filters by userId — you only ever touch your own data.",
  },
  {
    icon: Image,
    title: "Private-by-default images",
    detail: "Images are private unless explicitly published. The gallery and raw image route only serve rows marked public: true; everything else is owner-only.",
  },
  {
    icon: Timer,
    title: "Rate limiting",
    detail: "Sliding window: 20 req/min per user, plus tighter per-IP and per-account limits on the auth routes, with Retry-After on every 429.",
  },
  {
    icon: FileText,
    title: "Server-side validation",
    detail: "Prompt presence, a 2,000-char cap, magic-byte MIME sniffing, a 10 MB upload cap, and ObjectId validation on every mutation.",
  },
  {
    icon: Globe,
    title: "Security headers",
    detail: "Full CSP (script/frame/worker sources pinned), X-Frame-Options DENY, nosniff, Referrer-Policy, and a locked-down Permissions-Policy.",
  },
];

const ALGORITHMS = [
  {
    icon: Layers,
    title: "LRU cache",
    detail: "lib/lruCache.ts — a generic hashmap + doubly-linked list. get / set / evict are all O(1), the linked list tracks recency and the evicted node is always the true least-recently-used entry. It backs the image cache and the rate-limiter buckets, with optional TTL.",
    complexity: "O(1) get · O(1) set · O(1) evict",
  },
  {
    icon: Timer,
    title: "Sliding-window rate limiter",
    detail: "lib/rateLimit.ts — each user keeps a queue of request timestamps; stale ones are dropped from the FRONT (a deque) so the window always reflects the last 60s. Checks are O(1) amortized, and per-user windows are LRU-evicted after inactivity.",
    complexity: "O(1) amortized per check",
  },
  {
    icon: Binary,
    title: "Bloom filter",
    detail: "lib/bloomFilter.ts — constant-memory probabilistic duplicate-prompt detection. Every prompt is set at k-bit positions using double hashing (FNV-1a + cyrb32). Membership is O(k), never false-negative, and can only ever give a harmless false positive.",
    complexity: "O(k) membership · O(k) insert",
  },
];

const FEATURES = [
  {
    icon: Wand2,
    title: "Image generation",
    items: ["Staged 'Generating…' progress UI", "Width / height / seed / model controls", "Style presets + Enhance"],
  },
  {
    icon: MessageSquare,
    title: "AI chat (text)",
    items: ["SSE streaming + typewriter with blinking cursor", "Rendered Markdown (headings, lists, code)", "Model picker: Auto · Gemini · Pollinations", "Cross-chat memory — remembers your name & facts", "Daily free credits — live counter in the header"],
  },
  {
    icon: ScanText,
    title: "Vision / OCR",
    items: ["Upload any image", "Gemini understands it — describe / ask questions", "OCR.space fallback extracts the text", "Saved as vision chat history"],
  },
  {
    icon: Layers,
    title: "Similar & variations",
    items: ["One-click 'Similar'", "Up to 6 seed variations", "Copy prompt / download each"],
  },
  {
    icon: ImageUp,
    title: "Batch mode",
    items: ["1–8 images at once", "Parallel Pollinations requests", "Variation grid in chat"],
  },
  {
    icon: GalleryVerticalEnd,
    title: "History library",
    items: ["Pin · rename · delete", "Pinned items float to top", "Open & resume any chat"],
  },
  {
    icon: KeyRound,
    title: "Accounts & password reset",
    items: [
      "Email + password signup & login",
      "Forgot-password over email (Brevo → Resend)",
      "Single-use reset link, valid 1 hour",
      "Cloudflare Turnstile on every auth form",
      "Identical response whether or not the email exists",
    ],
  },
  {
    icon: Globe,
    title: "Explore gallery",
    items: ["Public images from all users", "Search + latest/popular/random", "Trending prompt chips"],
  },
  {
    icon: Search,
    title: "Command palette",
    items: ["Ctrl/Cmd + K anywhere", "Jump to pages / recent images", "New chat · history actions"],
  },
];

const UX = [
  { icon: Moon, title: "Dark mode", detail: "Flash-free theme script + persisted choice, no hydration mismatch." },
  { icon: Sparkles, title: "Aurora gradients", detail: "Glassmorphism hero, glow-border cards, indigo→purple→fuchsia accents." },
  { icon: Image, title: "Blur-up images", detail: "Shimmer skeleton while loading, smooth blur-in when ready." },
  { icon: RefreshCcw, title: "Friendly errors", detail: "Every Pollinations failure maps to a human message with a Retry action." },
  { icon: Copy, title: "Copy & download", detail: "One-click copy of prompts/text, download of generated images." },
  { icon: LayoutGrid, title: "Animated layout", detail: "Motion page transitions, staggered card entrances." },
];

const ENV = [
  { name: "MONGODB_URI", required: true, detail: "MongoDB Atlas connection string" },
  { name: "MONGODB_DB", required: false, detail: "Database name (default: ai_image_generator)" },
  { name: "SESSION_SECRET", required: true, detail: "Secret used to sign JWTs" },
  { name: "GEMINI_API_KEY", required: true, detail: "Key for Gemini text streaming, vision and image generation" },
  { name: "GEMINI_TEXT_MODEL", required: false, detail: "Text model id (default: gemini-3.1-flash-lite)" },
  { name: "GEMINI_VISION_MODEL", required: false, detail: "Vision model id (default: gemini-3.1-flash-lite)" },
  { name: "GEMINI_IMAGE_MODEL", required: false, detail: "Image model id (default: gemini-3.1-flash-image)" },
  { name: "OCR_SPACE_API_KEY", required: false, detail: "Key for the OCR fallback when Gemini vision is unavailable" },
  { name: "HF_TOKEN / HUGGINGFACE_API_KEY", required: false, detail: "Hugging Face image generation (optional provider)" },
  { name: "TOGETHER_API_KEY", required: false, detail: "Together AI image generation (optional provider)" },
  { name: "HORDE_API_KEY", required: false, detail: "AI Horde key — anonymous access by default" },
  { name: "FREE_IMAGE_CREDITS", required: false, detail: "Daily image limit (default: 5)" },
  { name: "FREE_TEXT_CREDITS", required: false, detail: "Daily chat limit (default: 30)" },
  { name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", required: true, detail: "Turnstile browser site key — inlined at build time, so a redeploy is required" },
  { name: "TURNSTILE_SECRET_KEY", required: true, detail: "Turnstile server secret — without it production fails closed" },
  { name: "TURNSTILE_EXPECTED_HOSTNAME", required: false, detail: "Advisory hostname check; warns but never rejects" },
  { name: "BREVO_API_KEY", required: false, detail: "Brevo API key (preferred email transport)" },
  { name: "BREVO_FROM_EMAIL", required: false, detail: "Brevo sender address" },
  { name: "BREVO_FROM_NAME", required: false, detail: "Brevo sender name (default: KanhaGen)" },
  { name: "RESEND_API_KEY", required: false, detail: "Resend API key (fallback email transport)" },
  { name: "MAIL_FROM", required: false, detail: "Resend sender (default: KanhaGen <no-reply@example.com>)" },
  { name: "APP_URL", required: false, detail: "Canonical base URL used to build password-reset links" },
];

const COMMANDS = [
  { cmd: "npm run dev", detail: "Start the development server (hot reload)" },
  { cmd: "npm run build", detail: "Create a production build" },
  { cmd: "npm run start", detail: "Serve the production build" },
  { cmd: "npm run lint", detail: "Run ESLint over the codebase" },
  { cmd: "npm run clean", detail: "Delete .next to reset a corrupt cache" },
];

const COMPONENT_TREE = [
  { level: 0, name: "app/layout.tsx", detail: "Root layout · fonts · ThemeProvider · GlobalPalette · Toaster" },
  { level: 1, name: "app/page.tsx", detail: "Home workspace (chat stream + sidebar skeleton)" },
  { level: 2, name: "ChatWindow.tsx", detail: "Hero, suggestions, message list" },
  { level: 2, name: "ChatMessage.tsx", detail: "User/AI bubbles, typewriter + Markdown, variants, lightbox" },
  { level: 2, name: "PromptInput.tsx", detail: "Textarea, image upload, batch toggle, enhance, reply-model picker" },
  { level: 2, name: "Sidebar.tsx", detail: "History list, pin/rename/delete, navigation" },
  { level: 1, name: "app/explore", detail: "Public gallery · trending · search · sort" },
  { level: 1, name: "app/history", detail: "Personal library · lightbox · regenerate actions" },
  { level: 1, name: "app/settings · login · signup", detail: "Preference and auth pages with password strength" },
  { level: 1, name: "app/forgot-password · reset-password", detail: "Reset request + token consumption, both captcha / throttle aware" },
  { level: 1, name: "app/about", detail: "This page — public, no login required" },
  { level: 1, name: "components/ui", detail: "Lightbox · BlurImage · GenerationStages · GlobalPalette · ThemeProvider · TurnstileWidget" },
  { level: 0, name: "lib/", detail: "chat · text · vision · memory · quota · httpError · pollinations · providers · session · mongodb · rateLimit · lruCache · bloomFilter · cache · watermark · turnstile · passwordReset · mailer · imageMime · request · captchaMessage · utils" },
  { level: 0, name: "app/api/", detail: "20 route handlers across auth, chat, generation, gallery and history" },
];

const METHOD_COLOR: Record<string, string> = {
  GET: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  POST: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  PATCH: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  DELETE: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};

function Section({
  id,
  index,
  title,
  subtitle,
  children,
}: {
  id: string;
  index: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-indigo-500/30">
          {index}
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-white/80 p-5 backdrop-blur-sm transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 ${className}`}
    >
      {children}
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <header>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 flex flex-wrap items-center justify-between gap-4"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur-sm transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-white"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              Back to the app
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Globe className="h-3.5 w-3.5" />
              Public — no login required
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="glow-border rounded-3xl p-[1px]"
          >
            <div className="rounded-3xl bg-white/70 p-8 backdrop-blur-xl sm:p-12 dark:bg-zinc-950/60">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/30">
                <Sparkles className="h-3.5 w-3.5" />
                Project documentation
              </div>
              <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
                  KanhaGen
                </span>
                {" "}— inside the project
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
                A full-stack AI image &amp; chat application. Users write prompts, upload photos or batch-generate
                images, and everything is saved to a personal, shareable gallery. This page documents exactly how it
                is built — every library, every route, every decision — end to end.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {STATS.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    <s.icon className="mx-auto h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                    <div className="mt-2 text-lg font-bold text-zinc-900 dark:text-white">{s.value}</div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-8 flex flex-wrap gap-2"
            aria-label="Sections"
          >
            {NAV.map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/[&]/g, "").replace(/\s+/g, "-")}`}
                className="rounded-full border border-zinc-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur-sm transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-indigo-500/50 dark:hover:text-indigo-300"
              >
                {item}
              </a>
            ))}
          </motion.nav>
        </header>

        <main className="mt-14 space-y-20">
          <Section id="overview" index="01" title="Overview" subtitle="What this project actually is">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <MessageSquare className="h-4 w-4 text-indigo-500" />
                  What it does
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  <li>· Generate AI images from a text prompt via Pollinations</li>
                  <li>· Ask questions and get streaming AI text answers — typewriter + rendered Markdown</li>
                  <li>· Personality memory: tell it your name once, every chat remembers it</li>
                  <li>· Upload an image to run OCR — the extracted text comes back as an answer</li>
                  <li>· Batch-generate 1–8 images, create variations, and download results</li>
                  <li>· Sign up, sign in, or reset a forgotten password by email — every auth form is captcha-protected</li>
                </ul>
              </Card>
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <DatabaseZap className="h-4 w-4 text-emerald-500" />
                  How it&apos;s stored
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  <li>· User accounts in a dedicated <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] dark:bg-zinc-800">users</code> collection</li>
                  <li>· Every generation saved to <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] dark:bg-zinc-800">image_history</code> (images, text, vision, batch)</li>
                  <li>· Daily credit buckets in <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] dark:bg-zinc-800">quotas</code>, one document per user per UTC day</li>
                  <li>· Images are <strong>private by default</strong> — only what you explicitly publish reaches the gallery</li>
                </ul>
              </Card>
            </div>
          </Section>

          <Section
            id="tech-stack"
            index="02"
            title="Tech Stack"
            subtitle="Every library, grouped by responsibility — nothing hidden"
          >
            <div className="grid gap-4 md:grid-cols-2">
              {STACK.map((group) => (
                <Card key={group.title}>
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${group.accent} text-white shadow-md`}
                    >
                      <group.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{group.title}</h3>
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {group.items.map((item) => (
                      <li key={item.name} className="flex items-start justify-between gap-3 text-sm">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.name}</span>
                        <span className="hidden text-right text-[12px] leading-relaxed text-zinc-500 sm:block dark:text-zinc-400">
                          {item.detail}
                        </span>
                        <span className="text-right text-[12px] leading-relaxed text-zinc-500 sm:hidden dark:text-zinc-400">
                          {item.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
            <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
              Note: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">axios</code> and{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">@google/generative-ai</code> are installed in
              package.json but are not used by the current code — Gemini is called over its REST + SSE endpoint with{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">fetch</code>, and OCR is handled by OCR.space.
            </p>
          </Section>

          <Section
            id="workflow"
            index="03"
            title="Workflow"
            subtitle="From prompt to pixels — the full request pipeline"
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FLOW.map((step) => (
                <Card key={step.title}>
                  <step.icon className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
                  <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{step.title}</h4>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{step.detail}</p>
                </Card>
              ))}
            </div>
            <div className="mt-4 grid gap-3 rounded-2xl border border-zinc-200 bg-white/60 p-5 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-900/40">
              {WORKFLOW_PIPELINE.map((s, i) => (
                <div key={s.name} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[11px] font-bold text-fuchsia-500">{i + 1}.</span>
                  <div>
                    <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{s.name}</div>
                    <div className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="architecture"
            index="04"
            title="Architecture"
            subtitle="App Router structure · server ↔ client split · shared libs"
          >
            <Card>
              <div className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Project structure</h3>
              </div>
              <div className="mt-4 space-y-1.5">
                {COMPONENT_TREE.map((row) => (
                  <div
                    key={row.name}
                    className="flex flex-col gap-0.5 rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-950/40"
                    style={{ marginLeft: `${row.level * 18}px` }}
                  >
                    <code className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">{row.name}</code>
                    <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{row.detail}</span>
                  </div>
                ))}
              </div>
            </Card>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <Braces className="h-4 w-4 text-indigo-500" />
                  Server vs client
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                  Pages are statically server-rendered; all interactive components (chat, prompt input, lightbox,
                  palette) are <code className="rounded bg-zinc-100 px-1.5 dark:bg-zinc-800">{"\"use client\""}</code>{" "}
                  components. API work lives entirely in Route Handlers with the Node.js runtime and force-dynamic
                  rendering.
                </p>
              </Card>
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <Binary className="h-4 w-4 text-emerald-500" />
                  Shared libraries
                </h3>
                <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/text</code> — Gemini + Pollinations streaming, error detection</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/pollinations</code> — fetch, 30s timeout, 1 retry, friendly errors</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/turnstile</code> — server-side captcha verification, fail-closed</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/passwordReset · mailer</code> — reset tokens + email delivery</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/session</code> — JWT create/verify</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/mongodb</code> — cached global connection</li>
                  <li><code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">lib/rateLimit · lruCache · bloomFilter</code> — the data-structure backbone</li>
                </ul>
              </Card>
            </div>
          </Section>

          <Section
            id="data-model"
            index="05"
            title="Data Model"
            subtitle="Four MongoDB collections power the entire app"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {DATABASE.map((col) => (
                <Card key={col.name}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <col.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{col.name}</h3>
                      <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{col.note}</p>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-1.5">
                    {col.fields.map((f) => (
                      <li
                        key={f.field}
                        className="flex items-start justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950/40"
                      >
                        <code className="text-[11.5px] font-medium text-indigo-600 dark:text-indigo-300">{f.field}</code>
                        <span className="text-[11px] text-zinc-500 sm:hidden dark:text-zinc-400">{f.desc}</span>
                        <span className="hidden text-[11px] text-zinc-500 sm:block dark:text-zinc-400">{f.desc}</span>
                      </li>
                    ))}
                  </ul>
                  {col.indexes && (
                    <p className="mt-3 rounded-lg border border-zinc-200 bg-emerald-500/5 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      {col.indexes}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </Section>

          <Section id="api-endpoints" index="06" title="API Endpoints" subtitle="26 endpoints across 20 Route Handlers — each one documented">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                    <tr className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      <th className="px-4 py-3 font-semibold">Method</th>
                      <th className="px-4 py-3 font-semibold">Path</th>
                      <th className="hidden px-4 py-3 font-semibold md:table-cell">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {API.map((row) => (
                      <tr key={row.method + row.path} className="bg-white hover:bg-zinc-50 dark:bg-zinc-950/40 dark:hover:bg-zinc-900/60">
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold ${METHOD_COLOR[row.method]}`}
                          >
                            {row.method}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11.5px] text-zinc-700 dark:text-zinc-200">{row.path}</td>
                        <td className="hidden px-4 py-2.5 text-[12px] text-zinc-500 md:table-cell dark:text-zinc-400">
                          {row.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              <span className="font-medium text-indigo-500">20 route files · 26 endpoints</span> — including the full auth
              flow (signup, login, forgot-password, reset-password), generation, gallery and a health route for raw image
              bytes.
            </p>
          </Section>

          <Section id="security" index="07" title="Security" subtitle="Passwords, sessions, ownership and abuse protection">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <Card key={item.title}>
                  <item.icon className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
                  <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</h4>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{item.detail}</p>
                </Card>
              ))}
            </div>
          </Section>

          <Section
            id="algorithms-data-structures"
            index="08"
            title="Algorithms & Data Structures"
            subtitle="Real, bounded-memory data structures behind the infra — not just Maps"
          >
            <div className="grid gap-4 md:grid-cols-3">
              {ALGORITHMS.map((item) => (
                <Card key={item.title} className="flex flex-col">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</h4>
                  <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{item.detail}</p>
                  <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <Zap className="h-3 w-3" />
                    {item.complexity}
                  </div>
                </Card>
              ))}
            </div>
          </Section>

          <Section id="features" index="09" title="Features" subtitle="What a user can actually do, end to end">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((item) => (
                <Card key={item.title} className="flex flex-col">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/15 text-indigo-500 dark:text-indigo-300">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</h4>
                  <ul className="mt-2 space-y-1.5">
                    {item.items.map((i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        {i}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </Section>

          <Section id="ui-ux" index="10" title="UI & UX" subtitle="The design system and the polish behind it">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {UX.map((item) => (
                <Card key={item.title}>
                  <item.icon className="h-5 w-5 text-fuchsia-500 dark:text-fuchsia-400" />
                  <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</h4>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{item.detail}</p>
                </Card>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-fuchsia-500/5 p-5 dark:border-zinc-800">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                <Palette className="h-4 w-4 text-indigo-500" />
                Design tokens
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                Tailwind v4 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">@theme</code> tokens ·
                indigo → purple → fuchsia gradients · zinc-950 dark surfaces · rounded-2xl cards ·
                backdrop-blur glass · custom aurora blobs, glow/border shimmer and blur-in animations defined in{" "}
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">globals.css</code>.
              </p>
            </div>
          </Section>

          <Section id="setup" index="11" title="Setup & Configuration" subtitle="Environment variables and everyday commands">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <KeyRound className="h-4 w-4 text-amber-500" />
                  Environment variables
                </h3>
                <ul className="mt-4 space-y-2">
                  {ENV.map((v) => (
                    <li key={v.name} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950/40">
                      <div>
                        <code className="text-[12px] font-medium text-indigo-600 dark:text-indigo-300">{v.name}</code>
                        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{v.detail}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          v.required
                            ? "bg-red-500/10 text-red-500 dark:text-red-400"
                            : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {v.required ? "required" : "optional"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <Terminal className="h-4 w-4 text-emerald-500" />
                  Commands
                </h3>
                <ul className="mt-4 space-y-2">
                  {COMMANDS.map((c) => (
                    <li key={c.cmd} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950/40">
                      <code className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">{c.cmd}</code>
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </Section>
        </main>

        <footer className="mt-20 rounded-2xl border border-zinc-200 bg-white/70 p-6 text-center backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-1 text-[11px] font-bold text-white">
<Sparkles className="h-3 w-3" />
              BUILT WITH NEXT.JS · TYPESCRIPT · TAILWIND · MONGODB · GEMINI · POLLINATIONS
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/" className="inline-flex items-center gap-1 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300">
              <Hash className="h-3 w-3" /> Home
            </Link>
            <Link href="/explore" className="inline-flex items-center gap-1 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300">
              <GalleryVerticalEnd className="h-3 w-3" /> Explore
            </Link>
            <Link href="/history" className="inline-flex items-center gap-1 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300">
              <Image className="h-3 w-3" /> Images
            </Link>
            <Link href="/settings" className="inline-flex items-center gap-1 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300">
              <Palette className="h-3 w-3" /> Settings
            </Link>
            <Link href="/login" className="inline-flex items-center gap-1 transition-colors hover:text-indigo-500 dark:hover:text-indigo-300">
              <Lock className="h-3 w-3" /> Login
            </Link>
          </div>
          <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
            This page is public and requires no login — share the link with anyone to explain how the project works.
          </p>
        </footer>
      </div>
    </div>
  );
}