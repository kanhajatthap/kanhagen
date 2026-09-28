"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { motion } from "motion/react";
import { Mail, ArrowLeft, Loader2, Send, BrainCircuit, ShieldCheck, CheckCircle2 } from "lucide-react";
import TurnstileWidget from "../../components/TurnstileWidget";

const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaToken }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 429) {
        const mins = json?.retryAfter ? Math.ceil(json.retryAfter / 60) : 15;
        setError(`Too many attempts. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
        setCaptchaResetKey((k) => k + 1);
        return;
      }
      if (res.status === 403) {
        setCaptchaResetKey((k) => k + 1);
      }
      if (!res.ok) {
        setError(json?.error || "Something went wrong. Please try again.");
        return;
      }

      // Always the same confirmation, whether or not the email exists — that is
      // deliberate, so the page can't be used to discover registered accounts.
      setSent(true);
      // Development convenience: the mailer prints the link and returns it.
      if (json?.devResetUrl) setDevResetUrl(json.devResetUrl);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen w-full">
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 p-10 text-white lg:flex">
        <div className="aurora-blob aurora-blob-1 -top-24 left-1/4 h-72 w-72 bg-white/10" />
        <div className="aurora-blob aurora-blob-2 -bottom-32 -right-16 h-80 w-80 bg-fuchsia-400/40" />
        <div className="aurora-blob aurora-blob-3 bottom-1/4 -left-20 h-64 w-64 bg-indigo-400/40" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-purple-900/30 to-transparent" />
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <BrainCircuit className="h-6 w-6 text-white" />
          </div>
          <span className="font-heading text-lg font-semibold tracking-tight">AI Studio</span>
        </Link>

        <div className="relative">
          <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight">
            Locked out?
            <br />
            It happens.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
            Enter the email you signed up with and we&apos;ll send a link to set a new password. The link works
            once and expires after an hour.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "Single-use link, valid for 1 hour",
              "We never email your password",
              "Your images and history stay untouched",
            ].map((text) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">Free AI image generation for your portfolio</p>
      </aside>

      <div className="flex w-full flex-col justify-center bg-white px-6 py-10 dark:bg-zinc-950 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="mx-auto w-full max-w-sm"
        >
          <div className="mb-8 text-center lg:text-left">
            <div className="mb-4 flex justify-center lg:hidden">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
                <BrainCircuit className="h-7 w-7 text-white" />
              </div>
            </div>
            <h1 className="font-heading text-3xl font-bold text-zinc-900 dark:text-white">Reset your password</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              We&apos;ll email you a link to choose a new one.
            </p>
          </div>

          {sent ? (
            <div className="glow-border rounded-2xl p-6 text-center shadow-lg shadow-zinc-200/40 dark:shadow-none">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">Check your inbox</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                If <span className="text-zinc-700 dark:text-zinc-300">{email}</span> is registered, a reset link is
                on its way. It expires in 1 hour.
              </p>

              {devResetUrl && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left dark:border-amber-900/50 dark:bg-amber-950/30">
                  <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Development only — no mail provider configured
                  </p>
                  <Link href={devResetUrl} className="text-xs break-all text-amber-800 underline dark:text-amber-300">
                    {devResetUrl}
                  </Link>
                </div>
              )}

              <Link
                href="/login"
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="glow-border space-y-4 rounded-2xl p-6 shadow-lg shadow-zinc-200/40 dark:shadow-none"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Registered email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="email"
                    className={inputClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </p>
              )}

              <TurnstileWidget
                action="forgot_password"
                resetKey={captchaResetKey}
                onVerify={setCaptchaToken}
                className="flex justify-center"
              />

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-semibold text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400"
            >
              Back to login
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
