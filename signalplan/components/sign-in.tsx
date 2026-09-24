"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  isAuthConfigured,
  setPreviewCookie,
  setSessionCookie,
  storeAccessToken,
  supabaseBrowser,
} from "@/lib/auth-browser";
import { Button, Card, ErrorBanner } from "@/components/ui";

/**
 * Invite-only email/password sign-in (brief §Password protection: disable
 * public signup for the prototype — there is deliberately no sign-up path
 * here). Fixture preview is an explicit operator choice, clearly labeled,
 * never a silent fallback for failed live calls. When Supabase credentials
 * are not configured (credential-free build), the form says so and only the
 * labeled preview is available; it never pretends to authenticate.
 */

export function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authConfigured = isAuthConfigured();

  async function submit() {
    if (!email.trim() || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const client = supabaseBrowser();
      if (!client) {
        setError("Sign-in is not configured on this deployment yet.");
        return;
      }
      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      if (!data.session) {
        setError("Sign-in succeeded but no session was returned.");
        return;
      }
      storeAccessToken(data.session.access_token);
      setSessionCookie(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function previewFixtures() {
    setPreviewCookie(true);
    router.refresh();
  }

  return (
    <Card title="Sign in to SignalPlan">
      {!authConfigured && (
        <div className="banner banner-warn" role="status">
          Auth is not configured on this deployment yet (missing Supabase
          credentials). You can still explore the app with clearly labeled
          fixture data.
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!authConfigured}
          />
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!authConfigured}
          />
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="row" style={{ marginTop: 8 }}>
          <Button variant="primary" disabled={!authConfigured || submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <Button variant="ghost" onClick={previewFixtures}>
            Preview with fixtures
          </Button>
        </div>
      </form>
      <p className="small muted" style={{ marginTop: 10 }}>
        Access is invite-only; public sign-up is disabled for this prototype.
        Fixture preview shows synthetic demonstration data, always labeled as
        such.
      </p>
    </Card>
  );
}
