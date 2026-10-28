import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Backdrop } from "@/components/Backdrop";
import { Nav } from "@/components/Nav";
import { THEME_BOOT, ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Susano",
  description: "An open-weights video studio on Comfy Cloud. Openjutsu recasts any video with your people.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets data-theme on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable}`}>
        <Backdrop />
        <div className="shell">
          <header className="topbar glass">
            <Link href="/" className="brand">Susano</Link>
            <Nav />
            <div className="topbar-end">
              <ThemeToggle />
              <span className="account" aria-hidden="true">R</span>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
