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
            <main className="min-w-0 flex-1 py-8 lg:pl-8">
              <div className="mx-auto max-w-3xl">{children}</div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
