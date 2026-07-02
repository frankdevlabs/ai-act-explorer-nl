import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { SearchResults } from "@/components/search/SearchResults";

export const metadata: Metadata = {
  title: "Zoeken",
  description: "Zoek in de volledige Nederlandse tekst van de AI-verordening (EU) 2024/1689",
};

export default function ZoekenPage() {
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Zoeken" }]} />
      <h1 className="mb-6 text-2xl font-bold">Zoeken</h1>
      <Suspense>
        <SearchResults />
      </Suspense>
    </div>
  );
}
