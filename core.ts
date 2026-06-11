/**
 * core.ts — pure, UI-free logic extracted from main.ts so it can be unit-tested.
 * No Obsidian imports allowed here.
 */

/* ── Conversion ───────────────────────────────────────────────────── */

/** File extensions the Distill engine can convert. */
export const CONVERTIBLE = new Set([
  "pdf", "docx", "xlsx", "xls", "pptx", "html", "htm", "csv", "json",
  "eml", "msg", "png", "jpg", "jpeg", "tiff", "tif", "heic", "gif", "bmp", "webp",
]);

/** True when a file extension (any case) is convertible by the engine. */
export function isConvertible(ext: string): boolean {
  return CONVERTIBLE.has(ext.toLowerCase());
}

/** Shell-escape a single argument (POSIX single-quote convention). */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/* ── Grades ───────────────────────────────────────────────────────── */

export interface GradeMeta {
  label: string;
  icon: string;
  css: string;
}

export const GRADE_META: Record<string, GradeMeta> = {
  vapor:      { label: "Vapor",      icon: "☁️",  css: "vapor" },      // ☁️
  distillate: { label: "Distillate", icon: "💧", css: "distillate" },  // 💧
  essence:    { label: "Essence",    icon: "💎", css: "essence" },     // 💎
};

export const VALID_GRADES = new Set(["vapor", "distillate", "essence"]);

/** Validate a raw frontmatter `grade` value; null when missing/invalid. */
export function normalizeGrade(raw: unknown): string | null {
  return typeof raw === "string" && VALID_GRADES.has(raw) ? raw : null;
}

/* ── Bond graph ───────────────────────────────────────────────────── */

export interface BondGraph {
  /** filePath → set of paths it links TO */
  outgoing: Map<string, Set<string>>;
  /** filePath → set of paths that link TO it */
  incoming: Map<string, Set<string>>;
}

export function emptyBondGraph(): BondGraph {
  return { outgoing: new Map(), incoming: new Map() };
}

/**
 * Build the Bond graph from Obsidian's `metadataCache.resolvedLinks` shape.
 * Each resolved [[wikilink]] becomes a directed Bond.
 * If `root` is set, only files under that prefix are indexed.
 */
export function buildBondGraph(
  resolved: Record<string, Record<string, number>>,
  root: string,
): BondGraph {
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();

  for (const [src, targets] of Object.entries(resolved)) {
    if (root && !src.startsWith(root)) continue;
    for (const tgt of Object.keys(targets)) {
      if (root && !tgt.startsWith(root)) continue;

      if (!out.has(src)) out.set(src, new Set());
      out.get(src)!.add(tgt);

      if (!inc.has(tgt)) inc.set(tgt, new Set());
      inc.get(tgt)!.add(src);
    }
  }

  return { outgoing: out, incoming: inc };
}

/** Total bond count = outgoing links + incoming links. */
export function bondCount(bonds: BondGraph, filePath: string): number {
  return (
    (bonds.outgoing.get(filePath)?.size ?? 0) +
    (bonds.incoming.get(filePath)?.size ?? 0)
  );
}

/** A note is a Condenser when its bond count meets the threshold. */
export function isCondenser(
  bonds: BondGraph,
  filePath: string,
  threshold: number,
): boolean {
  return bondCount(bonds, filePath) >= threshold;
}

/** Return Condenser notes that link TO the given file. */
export function referencingCondensers(
  bonds: BondGraph,
  filePath: string,
  threshold: number,
): string[] {
  const incoming = bonds.incoming.get(filePath);
  if (!incoming) return [];
  return [...incoming].filter((src) => isCondenser(bonds, src, threshold));
}
