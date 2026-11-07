/**
 * Rough per-million-token prices used only for the "≈ $0.03" hint in the result footer.
 * Checked 2026-11-07 against aistudio.google.com/docs/pricing (paid tier, prompts ≤ 200k tokens).
 * Google has announced rises (e.g. gemini-3.8-flash input $0.75 → $1.50 on 2027-01-01); the user's
 * bill is what the provider says it is.
 */
const PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-4-argon': { input: 2.0, output: 10.0 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3-flash-preview': { input: 0.5, output: 3.0 },
};

/** Gemini 3+: searches beyond the free monthly allowance (shared across models) cost $14 per 1,000. */
const GEMINI_SEARCH_USD = 14 / 1000;
export const GEMINI_FREE_SEARCHES_PER_MONTH = 5000;

export function estimateUsd(model: string, inputTokens = 0, outputTokens = 0, searches = 0): number | undefined {
  // Longest matching prefix wins, so "gemini-3.5-flash-lite" is not priced as "gemini-3.5-flash".
  const key = Object.keys(PER_MILLION)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return undefined;
  const p = PER_MILLION[key]!;
  const tokens = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
  // Searches are billed per query only after the free allowance; shown as the worst case.
  return tokens + searches * GEMINI_SEARCH_USD;
}
