import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plant ID",
  description: "Identify a plant from a photo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
