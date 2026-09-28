"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Mail, Lock, User, BrainCircuit, UserPlus, Loader2, Layers, Sparkles, Images, ShieldCheck, ShieldAlert } from "lucide-react";
import TurnstileWidget from "../../components/TurnstileWidget";
import { captchaMessage } from "../../lib/captchaMessage";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, captchaToken }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(captchaMessage(json?.code) || json?.details || json?.error || "Signup failed.");
        setCaptchaResetKey((k) => k + 1);
        return;
      }

      toast.success("Account created — welcome!");
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;
    return Math.min(4, score);
  }, [password]);

  const STRENGTH_META = {
    0: { label: "Enter a strong password", color: "bg-zinc-200 dark:bg-zinc-700", textColor: "text-zinc-400" },
    1: { label: "Weak", color: "bg-red-500", textColor: "text-red-500" },
    2: { label: "Fair", color: "bg-orange-500", textColor: "text-orange-500" },
    3: { label: "Good", color: "bg-yellow-500", textColor: "text-yellow-600" },
    4: { label: "Strong", color: "bg-emerald-500", textColor: "text-emerald-600" },
  } as const;

  const strengthMeta = STRENGTH_META[passwordStrength as keyof typeof STRENGTH_META];

  return (
    <main className="flex min-h-screen w-full">
      {/* Left: Gradient Brand Panel */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 p-10 text-white lg:flex">
        <div className="aurora-blob aurora-blob-1 -top-24 left-1/4 h-72 w-72 bg-white/10" />
        <div className="aurora-blob aurora-blob-2 -bottom-32 -right-16 h-80 w-80 bg-fuchsia-400/40" />
        <div className="aurora-blob aurora-blob-3 bottom-1/4 -left-20 h-64 w-64 bg-indigo-400/40" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-purple-900/30 to-transparent" />

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative"
        >
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
              <BrainCircuit className="h-6 w-6 text-white" />
            </div>
            <span className="font-heading text-lg font-semibold tracking-tight">KanhaGen</span>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative"
        >
          <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight">
            Your ideas,
            <br />
            turned into art.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
            Create an account to save your generations, explore the community gallery and build with AI.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              { icon: Layers, text: "Unlimited image generations with Pollinations AI" },
              { icon: Images, text: "Personal gallery with search & variations" },
              { icon: Sparkles, text: "One-tap prompt enhancement & styles" },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                  <item.icon className="h-4 w-4" />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </motion.div>

        <p className="relative text-xs text-white/60">Free & open — runs on next-generation AI</p>
      </aside>

      {/* Right: Form */}
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
            <h1 className="font-heading text-3xl font-bold text-zinc-900 dark:text-white">Create your account</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Save and manage your AI creations.</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="glow-border space-y-4 rounded-2xl p-6 shadow-lg shadow-zinc-200/40 dark:shadow-none"
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="email"
                  className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
                <span>Password</span>
                {password && (
                  <span className={`flex items-center gap-1 text-xs font-medium ${strengthMeta.textColor}`}>
                    {strengthMeta.label.toLowerCase() === "strong" ? (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    ) : password.length < 8 ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {strengthMeta.label}
                  </span>
                )}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="password"
                  className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < passwordStrength ? strengthMeta.color : "bg-zinc-200 dark:bg-zinc-700"}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="password"
                  className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-indigo-500"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <TurnstileWidget
              action="signup"
              resetKey={captchaResetKey}
              onVerify={setCaptchaToken}
              className="flex justify-center pt-1"
            />

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400"
            >
              Login
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}