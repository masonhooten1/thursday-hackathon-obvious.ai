import type { ReactNode } from "react";

interface StatusBannerProps {
  variant: "warning" | "error";
  title: string;
  children: ReactNode;
}

const VARIANT_ROLE = { warning: "status", error: "alert" } as const;

/** Honest-result banner shared by the low-confidence and error states. */
export default function StatusBanner({ variant, title, children }: StatusBannerProps) {
  return (
    <div className={`banner banner-${variant}`} role={VARIANT_ROLE[variant]}>
      <span className="banner-icon" aria-hidden="true">
        {variant === "warning" ? "⚠" : "✕"}
      </span>
      <p>
        <strong>{title}</strong> {children}
      </p>
    </div>
  );
}
