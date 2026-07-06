import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { SidebarToc } from "@/components/layout/SidebarToc";
import { TabStrip } from "@/components/layout/TabStrip";
import { SearchPalette } from "@/components/search/SearchPalette";
import { getAmendedArticleNumbers, getNewArticleTocEntries, getToc } from "@/lib/data";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI-verordening Explorer (NL)",
    template: "%s | AI-verordening Explorer",
  },
  description:
    "Doorzoekbare Nederlandse tekst van de AI-verordening (EU) 2024/1689: artikelen, overwegingen en bijlagen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const toc = getToc();
  const amended = [...getAmendedArticleNumbers()];
  const newEntries = getNewArticleTocEntries();
  return (
    <html
      lang="nl"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Header />
          <TabStrip />
          <MobileNav toc={toc} amended={amended} newEntries={newEntries} />
          <SearchPalette />
          <div className="mx-auto flex max-w-7xl px-4">
            <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-80 shrink-0 overflow-y-auto border-r border-line py-6 pr-4 lg:block">
              <SidebarToc toc={toc} amended={amended} newEntries={newEntries} />
            </aside>
            <main className="min-w-0 flex-1 break-words py-8 lg:pl-8">
              <div className="mx-auto max-w-3xl">{children}</div>
            </main>
          </div>
          <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted">
            <span className="border-t border-line pt-4 block">
              Gemaakt door{" "}
              <a
                href="https://www.linkedin.com/in/devriesfr/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="currentColor"
                  className="size-4"
                >
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
                </svg>
                Frank de Vries
              </a>
            </span>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
