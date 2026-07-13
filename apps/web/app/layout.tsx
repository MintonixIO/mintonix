import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Mintonix — Badminton analysis engine",
    template: "%s · Mintonix",
  },
  description:
    "Mintonix turns match footage into rallies, heatmaps, shot distributions, and head-to-head metrics for players and coaches.",
  icons: {
    icon: "/assets/logomark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        style={
          {
            "--font-sans": "var(--font-geist-sans), system-ui, sans-serif",
            "--font-mono": "var(--font-geist-mono), ui-monospace, monospace",
            "--font-display":
              "var(--font-space-grotesk), var(--font-geist-sans), system-ui, sans-serif",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
