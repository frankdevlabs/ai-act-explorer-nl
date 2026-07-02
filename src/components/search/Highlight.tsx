function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps query-term matches in <mark>. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const valid = terms.filter((t) => t.length >= 2).map(escapeRegExp);
  if (valid.length === 0) return <>{text}</>;
  const re = new RegExp(`(${valid.join("|")})`, "gi");
  // split with one capture group: matches land at odd indices
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-highlight text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
