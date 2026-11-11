import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Event registration" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
