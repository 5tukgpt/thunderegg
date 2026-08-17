/**
 * core.ts — pure, UI-free logic extracted from main.ts so it can be unit-tested.
 * No Obsidian imports allowed here.
 */

/* ── Conversion ───────────────────────────────────────────────────── */

/**
 * Audio/video extensions the engine transcribes on-device (whisper.cpp) and turns into a
 * structured meeting summary. Mirrors convert.sh's A/V case exactly; .mkv/.webm/.avi/.wmv are
 * deliberately absent — the engine refuses them with a named error, so offering them here would
 * promise a conversion that always fails.
 */
export const AV_EXTENSIONS = new Set([
  "mp3", "m4a", "wav", "aiff", "aif", "caf", "aac", "flac", "opus",
  "mp4", "mov", "m4v",
]);

/**
 * File extensions the Thunderegg engine can convert. Source of truth is convert.sh's extension
 * cases; .md is deliberately absent — inside an Obsidian vault every note is already .md, and
 * the engine's Markdown path is an importer, not a converter.
 */
export const CONVERTIBLE = new Set([
  "pdf", "docx", "doc", "rtf", "xlsx", "xls", "pptx", "html", "htm", "csv", "json",
  "eml", "msg", "png", "jpg", "jpeg", "tiff", "tif", "heic", "gif", "bmp", "webp",
  ...AV_EXTENSIONS,
]);

/** True when a file extension (any case) is convertible by the engine. */
export function isConvertible(ext: string): boolean {
  return CONVERTIBLE.has(ext.toLowerCase());
}

/** True for a recording (audio/video) — conversion means transcription and takes minutes, not seconds. */
export function isAudioVideo(ext: string): boolean {
  return AV_EXTENSIONS.has(ext.toLowerCase());
}

/** Shell-escape a single argument (POSIX single-quote convention). */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Token the engine prints to stderr when it has no on-device OCR binary to read an
 * image: it then exits non-zero and writes no .md, so the image was never looked at.
 * Spelled DISTILL_* because it is the engine's wire contract (convert.sh), not our
 * brand — renaming it here silently stops the detection below from ever matching.
 */
export const NO_OCR_TOKEN = "DISTILL_NO_OCR";

/**
 * True when a failed engine call reports it had no OCR to read an image — a different
 * failure from a missing or broken engine, and the only one with a user-facing remedy.
 * `promisify(exec)` rejects with an Error carrying the child's stderr as a string.
 */
export function isNoOcrError(e: unknown): boolean {
  const stderr = (e as { stderr?: unknown } | null | undefined)?.stderr;
  return typeof stderr === "string" && stderr.includes(NO_OCR_TOKEN);
}

/* ── Licence / trial refusals ──────────────────────────────────────
 * Thunderegg is $19.95 once, after a free trial of 5 conversions. When the engine refuses it
 * says WHY on stderr, and the two reasons are different people:
 *   DISTILL_TRIAL_EXHAUSTED — never bought, has no key and no purchase email
 *   DISTILL_UNLICENSED      — has a key to paste, or a revoked one
 * Without these the plugin reported both as "Is the Thunderegg app installed?" — which is
 * false (it is installed and it ran), sends the user hunting for a broken install, and leaves
 * the refusal NOTICE sitting in their vault as though it were a converted note.
 */
export const TRIAL_TOKEN = "DISTILL_TRIAL_EXHAUSTED";
export const UNLICENSED_TOKEN = "DISTILL_UNLICENSED";

function stderrOf(e: unknown): string {
  const s = (e as { stderr?: unknown } | null | undefined)?.stderr;
  return typeof s === "string" ? s : "";
}
export function isTrialExhaustedError(e: unknown): boolean {
  return stderrOf(e).includes(TRIAL_TOKEN);
}
export function isUnlicensedError(e: unknown): boolean {
  return stderrOf(e).includes(UNLICENSED_TOKEN);
}

/* ── Grades ───────────────────────────────────────────────────────── */

export interface GradeMeta {
  label: string;
  icon: string;
  css: string;
}

/**
 * The rock ladder — mirrors the engine's authority (markdown-droplet helpers/promote.py:
 * GRADES = blank/rough/polished/crystal/gem), which replaced the still ladder on 2026-07-16.
 * `synthesis` is not a ladder rung: moc.py stamps it on generated map pages (00-Maps).
 */
export const GRADE_META: Record<string, GradeMeta> = {
  blank:     { label: "Blank",     icon: "⬜", css: "blank" },
  rough:     { label: "Rough",     icon: "🪨", css: "rough" },
  polished:  { label: "Polished",  icon: "🔹", css: "polished" },
  crystal:   { label: "Crystal",   icon: "💠", css: "crystal" },
  gem:       { label: "Gem",       icon: "💎", css: "gem" },
  synthesis: { label: "Synthesis", icon: "🗺️", css: "synthesis" },
};

export const VALID_GRADES = new Set(Object.keys(GRADE_META));

/**
 * Legacy still-ladder names → canonical rock-ladder names. Mirrors promote.py LEGACY_GRADES:
 * "write new values, read both, forever — not a deprecation window, a permanent contract."
 * Vaults enriched before the rename carry these; they must keep badging.
 */
export const LEGACY_GRADES: Record<string, string> = {
  vapor: "blank",
  crude: "rough",
  distillate: "polished",
  refined: "crystal",
  essence: "gem",
};

/**
 * Validate a raw frontmatter `grade` value; legacy names canonicalize to the rock ladder;
 * null when missing/unknown. Unlike promote.canon_grade (which fails-safe to "blank" because
 * it gates enrichment), display code must NOT badge a note whose grade it cannot read.
 */
export function normalizeGrade(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const g = raw.trim().toLowerCase();
  if (VALID_GRADES.has(g)) return g;
  return LEGACY_GRADES[g] ?? null;
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
