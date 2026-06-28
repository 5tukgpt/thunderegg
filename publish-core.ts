/**
 * publish-core.ts — pure, UI-free logic for the "Publish concept map" feature.
 * No Obsidian imports allowed here (so it can be unit-tested like core.ts).
 *
 * Implements the on-device half of the local↔cloud publish contract:
 *   - transformCanvas(): Obsidian JSON Canvas  ->  distill.map/0.2 artifact
 *   - validatePublishMeta() / validateArtifact(): the server-mirrored checks
 *   - redactionScan(): the privacy zone + PII gate (regex, NO name NER — by design)
 *
 * Specs: ../distill-community/{concept-map-artifact-spec-v0.2,canvas-transform-spec}.md
 */

/* ═══════════════════════════════════════════════════════════════════
   Constants & enums (closed validation sets — server rejects unknowns)
   ═══════════════════════════════════════════════════════════════════ */

export const NODE_TEXT_CAP = 280;
export const SUMMARY_MIN = 150;
export const SUMMARY_MAX = 500;

export type Visibility = "private" | "followers" | "public";
export const VISIBILITIES: readonly Visibility[] = ["private", "followers", "public"];

export type NodeKind = "concept" | "source" | "question" | "claim";

export const SOURCE_TYPES = [
  "book", "paper", "article", "government-publication", "course",
  "video", "webpage", "dataset", "personal-notes", "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LICENSES = [
  "CC0-1.0", "public-domain", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0",
  "CC-BY-ND-4.0", "MIT", "Apache-2.0", "user-generated",
  "all-rights-reserved", "proprietary", "unknown",
] as const;
export type License = (typeof LICENSES)[number];

/** Tags whose presence blocks a publish unless the user clears the zone. */
export const DEFAULT_BLOCKED_ZONES = ["#health", "#work", "#client", "#private"];

/* ═══════════════════════════════════════════════════════════════════
   JSON Canvas input types (minimal subset of jsoncanvas/1.0)
   ═══════════════════════════════════════════════════════════════════ */

export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;   // text nodes
  file?: string;   // file nodes (vault path — never published)
  url?: string;    // link nodes
  color?: string;  // preset "1".."6" or hex
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;  // arrow direction — semantically meaningful, preserved
  toEnd?: string;
  label?: string;
  color?: string;
}

export interface Canvas {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

/* ═══════════════════════════════════════════════════════════════════
   Artifact (distill.map/0.2) — CLIENT fields only.
   author / id / map_uid / version / supersedes / published_at are
   server-authoritative and are NOT sent by the client.
   ═══════════════════════════════════════════════════════════════════ */

export interface MapNode {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;     // line 1 = label, remainder = note; total <= NODE_TEXT_CAP
  color?: string;
}

export interface MapEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;
  toEnd?: string;
  label?: string;
  color?: string;
}

export interface ProvenanceEntry {
  source_title: string;
  url: string;
  source_type: SourceType;
  license: License;
  accessed?: string;   // optional
}

/** User-supplied publish metadata (not derived from the canvas). */
export interface PublishMeta {
  title: string;
  summary: string;
  topics: string[];
  visibility: Visibility;
  license: License;
  provenance: ProvenanceEntry[];
  distill_version: string;
  /** Optional per-node kind overrides, keyed by node id. */
  kinds?: Record<string, NodeKind>;
}

export interface DistillMapArtifact {
  schema: "distill.map/0.2";
  client_uuid: string;
  title: string;
  summary: string;
  topics: string[];
  visibility: Visibility;
  map: {
    format: "jsoncanvas/1.0";
    nodes: MapNode[];
    edges: MapEdge[];
  };
  "x-distill": {
    nodes: Record<string, { kind: NodeKind }>;
  };
  provenance: ProvenanceEntry[];
  license: License;
  distill_version: string;
}

export interface ExcludedNode {
  id: string;
  type: string;
  reason: string;
}

export interface TransformResult {
  artifact: DistillMapArtifact;
  /** Soft issues the user should see (acknowledge-and-proceed). */
  warnings: string[];
  /** Hard issues that must be resolved before publishing. */
  blocking: string[];
  /** Nodes dropped from the publish (file/link/group/empty). */
  excluded: ExcludedNode[];
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

/** First non-empty line of a node's text, with leading markdown heading marks stripped. */
export function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line) return line.replace(/^#{1,6}\s+/, "").trim();
  }
  return "";
}

/**
 * Minimal kind inference: the only reliable heuristic is "ends with ? -> question".
 * Everything else defaults to "concept"; the user overrides in the confirm modal.
 * (No brittle source/claim auto-detection — see canvas-transform-spec §3.)
 */
export function inferKind(text: string): NodeKind {
  return firstLine(text).endsWith("?") ? "question" : "concept";
}

/* ═══════════════════════════════════════════════════════════════════
   Transform: Canvas -> distill.map/0.2
   ═══════════════════════════════════════════════════════════════════ */

export function transformCanvas(
  canvas: Canvas,
  meta: PublishMeta,
  clientUuid: string,
): TransformResult {
  const warnings: string[] = [];
  const blocking: string[] = [];
  const excluded: ExcludedNode[] = [];

  const nodes: MapNode[] = [];
  const kinds: Record<string, { kind: NodeKind }> = {};
  const includedIds = new Set<string>();

  for (const n of canvas.nodes ?? []) {
    if (n.type === "group") {
      // Visual-only; dropped silently (no warning) per spec.
      excluded.push({ id: n.id, type: "group", reason: "group (visual-only)" });
      continue;
    }
    if (n.type === "file") {
      excluded.push({ id: n.id, type: "file", reason: "file node references a vault path (privacy)" });
      warnings.push(`Excluded file node "${n.file ?? n.id}" — convert it to a text node to publish it.`);
      continue;
    }
    if (n.type === "link") {
      excluded.push({ id: n.id, type: "link", reason: "link node URL belongs in provenance" });
      warnings.push(`Excluded link node "${n.url ?? n.id}" — add its URL as a provenance entry instead.`);
      continue;
    }

    // text node
    const text = (n.text ?? "").trim();
    if (!text) {
      excluded.push({ id: n.id, type: "text", reason: "empty text node" });
      continue;
    }
    if (text.length > NODE_TEXT_CAP) {
      blocking.push(`Node "${firstLine(text).slice(0, 40)}…" is ${text.length} chars (max ${NODE_TEXT_CAP}). Shorten it before publishing.`);
    }

    nodes.push({
      id: n.id,
      type: "text",
      x: n.x, y: n.y, width: n.width, height: n.height,
      text,
      ...(n.color !== undefined ? { color: n.color } : {}),
    });
    includedIds.add(n.id);
    const kind = meta.kinds?.[n.id] ?? inferKind(text);
    kinds[n.id] = { kind };
  }

  if (nodes.length === 0) {
    blocking.push("This canvas has no text nodes to publish.");
  }

  // Edges: keep only those whose endpoints are both included.
  const edges: MapEdge[] = [];
  for (const e of canvas.edges ?? []) {
    if (!includedIds.has(e.fromNode) || !includedIds.has(e.toNode)) {
      excluded.push({ id: e.id, type: "edge", reason: "edge endpoint was excluded" });
      warnings.push(`Dropped an edge connected to an excluded node.`);
      continue;
    }
    edges.push({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      ...(e.fromSide !== undefined ? { fromSide: e.fromSide } : {}),
      ...(e.toSide !== undefined ? { toSide: e.toSide } : {}),
      ...(e.fromEnd !== undefined ? { fromEnd: e.fromEnd } : {}),
      ...(e.toEnd !== undefined ? { toEnd: e.toEnd } : {}),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.color !== undefined ? { color: e.color } : {}),
    });
  }

  const artifact: DistillMapArtifact = {
    schema: "distill.map/0.2",
    client_uuid: clientUuid,
    title: meta.title,
    summary: meta.summary,
    topics: meta.topics,
    visibility: meta.visibility,
    map: { format: "jsoncanvas/1.0", nodes, edges },
    "x-distill": { nodes: kinds },
    provenance: meta.provenance,
    license: meta.license,
    distill_version: meta.distill_version,
  };

  blocking.push(...validatePublishMeta(meta));

  return { artifact, warnings, blocking, excluded };
}

/* ═══════════════════════════════════════════════════════════════════
   Validation (mirrors the server-side checks in auth-and-api-spec §3.3)
   ═══════════════════════════════════════════════════════════════════ */

export function validatePublishMeta(meta: PublishMeta): string[] {
  const errs: string[] = [];

  const len = meta.summary.trim().length;
  if (len < SUMMARY_MIN || len > SUMMARY_MAX) {
    errs.push(`Summary must be ${SUMMARY_MIN}–${SUMMARY_MAX} chars (currently ${len}).`);
  }
  if (!meta.topics || meta.topics.length < 1) {
    errs.push("At least one topic is required.");
  }
  if (!VISIBILITIES.includes(meta.visibility)) {
    errs.push(`Invalid visibility "${meta.visibility}".`);
  }
  if (!(LICENSES as readonly string[]).includes(meta.license)) {
    errs.push(`Invalid map license "${meta.license}".`);
  }
  if (!meta.provenance || meta.provenance.length < 1) {
    errs.push("At least one provenance entry is required.");
  } else {
    meta.provenance.forEach((p, i) => {
      if (!p.source_title?.trim()) errs.push(`Provenance #${i + 1}: source_title is required.`);
      if (!p.url?.trim()) errs.push(`Provenance #${i + 1}: url is required.`);
      if (!(SOURCE_TYPES as readonly string[]).includes(p.source_type)) {
        errs.push(`Provenance #${i + 1}: invalid source_type "${p.source_type}".`);
      }
      if (!(LICENSES as readonly string[]).includes(p.license)) {
        errs.push(`Provenance #${i + 1}: invalid license "${p.license}".`);
      }
    });
  }
  return errs;
}

/** Full structural re-check of an assembled artifact (defense in depth). */
export function validateArtifact(a: DistillMapArtifact): string[] {
  const errs: string[] = [];
  if (a.schema !== "distill.map/0.2") errs.push(`Unexpected schema "${a.schema}".`);
  if (a.map?.format !== "jsoncanvas/1.0") errs.push(`Unexpected map.format "${a.map?.format}".`);
  for (const n of a.map?.nodes ?? []) {
    if (n.text.length > NODE_TEXT_CAP) errs.push(`Node ${n.id} exceeds ${NODE_TEXT_CAP} chars.`);
  }
  errs.push(...validatePublishMeta({
    title: a.title, summary: a.summary, topics: a.topics, visibility: a.visibility,
    license: a.license, provenance: a.provenance, distill_version: a.distill_version,
  }));
  return errs;
}

/* ═══════════════════════════════════════════════════════════════════
   Redaction / zone / PII gate (on-device privacy boundary)
   ═══════════════════════════════════════════════════════════════════ */

export interface RedactionResult {
  /** Hard blocks (zone matches) — publish is disabled until cleared. */
  blocks: string[];
  /** Soft PII warnings — acknowledge-and-proceed. */
  warnings: string[];
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/;
const RE_HANDLE = /(?:^|\s)@[A-Za-z0-9_]{2,}/;
const RE_URL = /https?:\/\/\S+/;

/** Normalize a tag/topic for zone comparison: leading '#' stripped, lowercased. */
function normTag(s: string): string {
  return s.replace(/^#/, "").trim().toLowerCase();
}

/**
 * Scans node bodies AND metadata (title, summary, topics, provenance.source_title)
 * for blocked zones and PII. NAME detection is intentionally NOT performed
 * (a zero-dependency regex can't do reliable NER — see canvas-transform-spec §4).
 */
export function redactionScan(
  artifact: DistillMapArtifact,
  blockedZones: string[] = DEFAULT_BLOCKED_ZONES,
): RedactionResult {
  const blocks: string[] = [];
  const warnings: string[] = [];

  const blocked = new Set(blockedZones.map(normTag));

  // 1. Zone match over topics + any #tags embedded in title/node text.
  const taggedSources: { where: string; text: string }[] = [
    { where: "title", text: artifact.title },
    ...artifact.map.nodes.map((n) => ({ where: `node ${n.id}`, text: n.text })),
  ];
  for (const topic of artifact.topics) {
    if (blocked.has(normTag(topic))) blocks.push(`Topic "${topic}" is in a blocked privacy zone.`);
  }
  for (const { where, text } of taggedSources) {
    const tags = text.match(/#[A-Za-z0-9_/-]+/g) ?? [];
    for (const t of tags) {
      if (blocked.has(normTag(t))) blocks.push(`Tag "${t}" (in ${where}) is in a blocked privacy zone.`);
    }
  }

  // 2. PII scan (best-effort warnings) over node bodies + metadata.
  const piiSources: { where: string; text: string }[] = [
    { where: "title", text: artifact.title },
    { where: "summary", text: artifact.summary },
    { where: "topics", text: artifact.topics.join(" ") },
    ...artifact.map.nodes.map((n) => ({ where: `node ${n.id}`, text: n.text })),
    ...artifact.provenance.map((p, i) => ({ where: `provenance #${i + 1} title`, text: p.source_title })),
  ];
  for (const { where, text } of piiSources) {
    if (RE_EMAIL.test(text)) warnings.push(`Possible email address in ${where}.`);
    if (RE_PHONE.test(text)) warnings.push(`Possible phone number in ${where}.`);
    if (RE_HANDLE.test(text)) warnings.push(`Possible @handle in ${where}.`);
    if (RE_URL.test(text)) warnings.push(`A URL appears in ${where} — make sure it isn't private.`);
  }

  return { blocks, warnings };
}

/* ═══════════════════════════════════════════════════════════════════
   Export sidecar (account-free sharing — no server, no network)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Human-readable provenance/license companion for an exported map. The map
 * itself travels as the `.distill.json` (distill.map/0.2); this sidecar makes
 * the sources + license legible when the file is shared (e.g. in Discord).
 * Pure — no Obsidian, no network. Sharing a map never requires an account.
 */
/** Detached authorship signature over the exported `.distill.json` bytes (see publish-sign.ts). */
export interface ArtifactSignature {
  algo: string;
  public_key: string;
  signature: string;
}

export function buildSidecar(artifact: DistillMapArtifact, signature?: ArtifactSignature): string {
  const topicsYaml = artifact.topics.map((t) => JSON.stringify(t)).join(", ");
  const lines: string[] = [
    "---",
    `title: ${JSON.stringify(artifact.title)}`,
    `schema: ${artifact.schema}`,
    `license: ${artifact.license}`,
    `visibility: ${artifact.visibility}`,
    `topics: [${topicsYaml}]`,
  ];
  if (signature) {
    lines.push(
      `signature_algo: ${signature.algo}`,
      `public_key: ${signature.public_key}`,
      `signature: ${signature.signature}`,
    );
  }
  lines.push(
    "---",
    "",
    `# ${artifact.title}`,
    "",
    artifact.summary,
    "",
    `**License:** ${artifact.license}`,
    "",
    "## Sources",
  );
  for (const p of artifact.provenance) {
    const acc = p.accessed ? ` (accessed ${p.accessed})` : "";
    lines.push(`- ${p.source_title} — ${p.url} · ${p.source_type} · ${p.license}${acc}`);
  }
  lines.push(
    "",
    "_Exported from Distill. The concept map is in the companion `.distill.json` (distill.map/0.2). Share both together._",
  );
  if (signature) {
    lines.push(
      `_Signed (${signature.algo}). Verify the exact bytes of the \`.distill.json\` against \`public_key\` above._`,
    );
  }
  return lines.join("\n");
}
