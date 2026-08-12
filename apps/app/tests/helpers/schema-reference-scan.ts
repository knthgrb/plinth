import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

export type SchemaReferenceMatch = {
  symbol: string;
  file: string;
  line: number;
};

const SOURCE_ROOTS = ["app", "components", "convex", "lib", "utils"];
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const IDENTIFIER_CONTINUATION = "\\p{ID_Continue}$";

export const DEFAULT_SCHEMA_REFERENCE_EXCLUSIONS: readonly RegExp[] = [
  /(?:^|\/)schema\.ts$/,
  /(?:^|\/)(?:schemaFieldManifest|fullSchemaInventory|fullSchemaCleanupRegistry)\.ts$/,
  /(?:^|\/)(?:_generated|generated)(?:\/|$)/,
  /(?:^|\/)(?:[^/]*Migration(?:s)?[^/]*|(?:migration|migrations)(?:[._-][^/]*)?|[^/]*[._-](?:migration|migrations)(?:[._-][^/]*)?)\.(?:[cm]?[jt]sx?)$/,
  /(?:^|\/)(?:tests|docs)(?:\/|$)/,
];

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const symbolPattern = (symbol: string): RegExp => {
  const segments = symbol.split(".").map(escapeRegularExpression);
  const dottedPath = segments.join("\\s*\\??\\.\\s*");
  return new RegExp(
    `(?<![${IDENTIFIER_CONTINUATION}])${dottedPath}(?![${IDENTIFIER_CONTINUATION}])`,
    "gu",
  );
};

const isExcluded = (file: string, exclusions: readonly RegExp[]): boolean =>
  exclusions.some((exclusion) => {
    exclusion.lastIndex = 0;
    const excluded = exclusion.test(file);
    exclusion.lastIndex = 0;
    return excluded;
  });

const relativeFile = (root: string, file: string): string | null => {
  const path = relative(root, file);
  if (!path || path === ".." || path.startsWith(`..${sep}`)) return null;
  return path.split(sep).join("/");
};

const sourceFiles = (root: string, exclusions: readonly RegExp[]): string[] => {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue;

      const path = relativeFile(root, file);
      if (path && !isExcluded(path, exclusions)) files.push(file);
    }
  };

  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = resolve(root, sourceRoot);
    try {
      visit(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return files;
};

const lineOffsets = (source: string): number[] => {
  const offsets = [0];
  let offset = source.indexOf("\n");
  while (offset !== -1) {
    offsets.push(offset + 1);
    offset = source.indexOf("\n", offset + 1);
  }
  return offsets;
};

const lineAt = (offsets: readonly number[], offset: number): number => {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
};

export function scanSchemaReferences(
  root: string,
  symbols: readonly string[],
  exclusions: readonly RegExp[],
): SchemaReferenceMatch[] {
  const uniqueSymbols = [...new Set(symbols.filter((symbol) => symbol.length > 0))].sort();
  const matches = new Map<string, SchemaReferenceMatch>();
  const resolvedRoot = resolve(root);

  for (const file of sourceFiles(resolvedRoot, exclusions)) {
    const source = readFileSync(file, "utf8");
    const offsets = lineOffsets(source);
    const path = relativeFile(resolvedRoot, file);
    if (!path) continue;

    for (const symbol of uniqueSymbols) {
      const pattern = symbolPattern(symbol);
      for (const match of source.matchAll(pattern)) {
        const reference = {
          symbol,
          file: path,
          line: lineAt(offsets, match.index),
        };
        matches.set(`${symbol}\u0000${path}\u0000${reference.line}`, reference);
      }
    }
  }

  return [...matches.values()].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.symbol.localeCompare(right.symbol),
  );
}
