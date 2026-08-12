import { createHash } from "node:crypto";
import type { SchemaReferenceMatch } from "./schema-reference-scan";

export type SchemaReferenceSymbolSummary = {
  symbol: string;
  matches: number;
  files: number;
};

export type SchemaReferenceSummary = {
  totalMatches: number;
  fileCount: number;
  fingerprint: string;
  symbols: SchemaReferenceSymbolSummary[];
};

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function summarizeSchemaReferences(
  matches: readonly SchemaReferenceMatch[],
): SchemaReferenceSummary {
  const files = new Set<string>();
  const pairs = new Set<string>();
  const symbols = new Map<string, { matches: number; files: Set<string> }>();

  for (const { symbol, file } of matches) {
    files.add(file);
    pairs.add(`${symbol}\u0000${file}`);
    const summary = symbols.get(symbol) ?? { matches: 0, files: new Set() };
    summary.matches += 1;
    summary.files.add(file);
    symbols.set(symbol, summary);
  }

  const symbolSummaries = [...symbols.entries()]
    .map(([symbol, summary]) => ({
      symbol,
      matches: summary.matches,
      files: summary.files.size,
    }))
    .sort((left, right) => compare(left.symbol, right.symbol));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        pairs: [...pairs].sort(compare),
        totalMatches: matches.length,
        symbols: symbolSummaries,
      }),
    )
    .digest("hex");

  return {
    totalMatches: matches.length,
    fileCount: files.size,
    fingerprint,
    symbols: symbolSummaries,
  };
}
