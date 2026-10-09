/**
 * Public origin of the deployed explorer. Exported documents (the AI-register
 * dossier) are read outside the app — in a mail, a file, a spreadsheet — so
 * their deep links must be absolute; relative hrefs would be dead there.
 *
 * Deliberately a plain constant, not an env var: the export runs in the
 * browser from a statically exported bundle. The MCP server keeps its own,
 * env-overridable `BASE_URL` (mcp/src/data.ts) — change both together.
 */
export const SITE_ORIGIN = "https://aia.mrfrank.dev";
