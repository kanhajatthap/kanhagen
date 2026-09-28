import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

/**
 * The form reads the token from the query string, which opts it into
 * client-side rendering. Next requires a <Suspense> boundary so the rest of the
 * route can still be prerendered.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen w-full items-center justify-center bg-white px-6 dark:bg-zinc-950">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
