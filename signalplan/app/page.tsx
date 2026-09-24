"use client";

import { useEffect, useState } from "react";
import { getAccessToken, setPreviewCookie } from "@/lib/auth-browser";
import { isFixturePreview, selectSources } from "@/lib/sources";
import { DashboardClient } from "@/components/dashboard-client";
import { SignIn } from "@/components/sign-in";
import { Spinner } from "@/components/ui";

/**
 * Entry gate. The preview cookie is readable on the client immediately, so
 * the fixture-preview choice renders without depending on server state; the
 * real access token lives in localStorage and is verified per-request by
 * every API route, so client gating here is UX only — authorization never
 * trusts this check.
 */
export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fixturePreview = isFixturePreview();

  if (!mounted) {
    return (
      <main className="page">
        <Spinner label="Loading…" />
      </main>
    );
  }

  if (!fixturePreview && !getAccessToken()) {
    return (
      <main className="page page-narrow">
        <SignIn />
      </main>
    );
  }

  return (
    <main className="page">
      <DashboardClient sources={selectSources()} />
      {fixturePreview && (
        <button
          className="link small exit-preview"
          onClick={() => {
            setPreviewCookie(false);
            window.location.reload();
          }}
        >
          Exit fixture preview
        </button>
      )}
    </main>
  );
}
