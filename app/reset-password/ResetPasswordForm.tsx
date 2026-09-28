"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  BrainCircuit,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Lock,
} from "lucide-react";

const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500";

/**
 * Cheap, honest strength estimate. Length is weighted heavily and variety is
 * rewarded, but there is no dictionary check — the label is a nudge, and the
 * server enforces the real rule.
 */
function scorePassword(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: "" };

  let points = 0;
  if (pw.length >= 8) points++;
  if (pw.length >= 12) points++;
  if (pw.length >= 16) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;

  const score = Math.min(3, points >= 5 ? 3 : points >= 3 ? 2 : 1) as 0 | 1 | 2 | 3;
  return { score, label: ["", "Weak", "Good", "Strong"][score] };
}

const barColors: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-green-500",
};

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit = Boolean(token) && password.length >= MIN_PASSWORD_LENGTH && !mismatch && !loading;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword: confirm }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 429) {
        setError("Too many attempts. Please request a fresh reset link.");
        return;
      }
      if (!res.ok) {
        setError(json?.error || "Could not update the password.");
        return;
      }

      setDone(true);
      // Drop the token from the address bar so it isn't left in history.
      router.replace("/reset-password");
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-white px-6 dark:bg-zinc-950">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/40">
            <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Link is incomplete</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            This page needs a reset link. Open the link from your email, or request a new one.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-white px-6 dark:bg-zinc-950">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm text-center"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
            <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Password updated</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Taking you to the login page…
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            Go to login now
          </Link>
        </motion.div>
      </main>
    );
  }

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
          <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight">Choose a new password</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
            Pick something you haven&apos;t used here before. Once saved, you&apos;ll sign in with it right away.
          </p>
          <ul className="mt-8 space-y-3">
            {["At least 8 characters", "Stored as a bcrypt hash, never in plain text", "This link works only once"].map(
              (text) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  {text}
                </li>
              ),
            )}
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
            <h1 className="font-heading text-3xl font-bold text-zinc-900 dark:text-white">Set a new password</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">This replaces your old password.</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="glow-border space-y-4 rounded-2xl p-6 shadow-lg shadow-zinc-200/40 dark:shadow-none"
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                New password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type={show ? "text" : "password"}
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                />
              </div>

              {password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          strength.score >= i ? barColors[strength.score] : "bg-zinc-200 dark:bg-zinc-800"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="w-12 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {strength.label}
                  </span>
                </div>
              )}

              {tooShort && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                  Needs at least {MIN_PASSWORD_LENGTH} characters.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type={show ? "text" : "password"}
                  className={inputClass}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Type it again"
                />
              </div>
              {mismatch && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">Passwords do not match.</p>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
              Show password
            </label>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Changed your mind?{" "}
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
