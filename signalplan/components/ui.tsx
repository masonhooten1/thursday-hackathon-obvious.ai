"use client";

import type { ReactNode } from "react";

/** Minimal shared primitives — the app has no component library by design. */

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  variant = "default",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const cls = variant === "default" ? undefined : variant;
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="muted small" role="status" aria-live="polite">
      {label ?? "Loading…"}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius)",
        padding: "28px 20px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
      }}
    >
      <strong>{title}</strong>
      {hint && <span className="muted small">{hint}</span>}
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner banner-error" role="alert">
      {message}
    </div>
  );
}
