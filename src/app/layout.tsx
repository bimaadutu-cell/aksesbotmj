import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKSESBOTMU — Panel Bot Telegram Realtime",
  description: "Hubungkan dan kelola Bot Telegram secara real-time melalui Telegram Bot API. Developed by Bimz Official.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <div className="grid-bg" aria-hidden />
        <div className="scanline" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
