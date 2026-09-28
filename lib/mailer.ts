/**
 * Outbound email.
 *
 * Two real transports, picked by what's configured:
 *
 *  1. `BREVO_API_KEY` + `BREVO_FROM_EMAIL` -> Brevo's HTTP API.
 *     Chosen first because Brevo lets you verify a plain email address as a
 *     sender, so no domain ownership is needed.
 *  2. `RESEND_API_KEY` + `MAIL_FROM`      -> Resend's HTTP API. Kept as a
 *     fallback; Resend requires a verified *domain*, so it is only usable once
 *     one is configured.
 *  3. development, no transport -> print the reset link to the server log and
 *     return it so the flow stays testable locally.
 *  4. production, no transport -> log loudly and report failure. The caller must
 *     still answer the user with a generic "check your inbox" response:
 *     revealing that the mail failed would let an attacker probe which
 *     addresses are registered.
 *
 * The raw reset token must never be logged or returned in production.
 */

export interface MailResult {
  delivered: boolean;
  /** Populated in development only, so the reset link can be used locally. */
  previewUrl?: string;
  error?: string;
}

export type Transport = "brevo" | "resend" | "dev-preview" | "none";

/** Which transport the current environment resolves to. */
export function resolveTransport(): Transport {
  if (process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL) return "brevo";
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) return "resend";
  return process.env.NODE_ENV === "production" ? "none" : "dev-preview";
}

function resetEmailHtml(resetUrl: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">Reset your password</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#52525b;">
        We received a request to reset the password for your AI Studio account.
        Click the button below to choose a new one. This link expires in 1 hour
        and can only be used once.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${resetUrl}"
           style="display:inline-block;background:linear-gradient(90deg,#6366f1,#9333ea);color:#fff;
                  text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:12px;">
          Reset password
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;color:#71717a;">
        Button not working? Paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#71717a;">${resetUrl}</p>
      <p style="margin:0;font-size:12px;color:#a1a1aa;">
        If you did not request this, you can safely ignore this email — your
        password will not change.
      </p>
    </div>
  </body>
</html>`;
}

function resetEmailText(resetUrl: string): string {
  return [
    "Reset your password",
    "",
    "We received a request to reset the password for your AI Studio account.",
    "Open the link below to choose a new one. It expires in 1 hour and can only be used once.",
    "",
    resetUrl,
    "",
    "If you did not request this, you can safely ignore this email — your password will not change.",
  ].join("\n");
}

async function sendViaBrevo(to: string, resetUrl: string): Promise<MailResult> {
  const apiKey = process.env.BREVO_API_KEY!;
  const fromEmail = process.env.BREVO_FROM_EMAIL!;
  const fromName = process.env.BREVO_FROM_NAME || "AI Studio";

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to }],
        subject: "Reset your AI Studio password",
        htmlContent: resetEmailHtml(resetUrl),
        textContent: resetEmailText(resetUrl),
        // The link is the whole point of the email; a spam filter must not
        // rewrite or hide it.
        tags: ["password-reset"],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mailer] Brevo rejected the message:", res.status, body);
      return { delivered: false, error: `brevo_${res.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error("[mailer] Brevo request failed:", error);
    return { delivered: false, error: "brevo_request_failed" };
  }
}

async function sendViaResend(to: string, resetUrl: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.MAIL_FROM || "AI Studio <no-reply@example.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Reset your AI Studio password",
        html: resetEmailHtml(resetUrl),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mailer] Resend rejected the message:", res.status, body);
      return { delivered: false, error: `resend_${res.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error("[mailer] Resend request failed:", error);
    return { delivered: false, error: "resend_request_failed" };
  }
}

/**
 * Sends the password-reset email. Never throws — a mail failure must not turn
 * into a 500 that tells the caller the address exists.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<MailResult> {
  switch (resolveTransport()) {
    case "brevo":
      return sendViaBrevo(to, resetUrl);
    case "resend":
      return sendViaResend(to, resetUrl);
    case "dev-preview":
      console.info(`\n[mailer] No mail transport configured — password reset link for ${to}:\n${resetUrl}\n`);
      return { delivered: false, previewUrl: resetUrl };
    case "none":
    default:
      // Production without a transport: fail loudly in the logs, silently to the user.
      console.error(
        `[mailer] Cannot send password reset email: no transport configured (recipient ${to}). ` +
          "Set BREVO_API_KEY + BREVO_FROM_EMAIL, or RESEND_API_KEY + MAIL_FROM.",
      );
      return { delivered: false, error: "mailer_not_configured" };
  }
}
