import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StayRadar — Vacation rentals by radius",
  description:
    "Vacation rental aggregation with real availability and radius-native search. Demo scaffold — inventory is fixture data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
