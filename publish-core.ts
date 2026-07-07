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

/** AI-assistance disclosure. OPTIONAL — an absent value means undisclosed. */
export type AiAssisted = "none" | "drafted" | "edited";
export const AI_ASSISTED: readonly AiAssisted[] = ["none", "drafted", "edited"];

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
  draft?: boolean; // custom property (JSON Canvas tolerates extras) — truthy = never exported
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
  accessed?: string;       // optional
  source_key?: string;     // normalized url — the overlap-corpus key (derived on export)
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
  /** Optional AI-assistance disclosure (absent = undisclosed). */
  ai_assisted?: AiAssisted;
}

/**
 * Fork lineage receipt — records what a fork was made FROM, keyed on values
 * that exist in account-free exports (map_uid is server-authoritative and is
 * deliberately NOT used). content_hash = sha256 of the canonical map JSON
 * (the exact bytes of the `.distill.json` copy retained in Forked/).
 */
export interface ForkLineage {
  client_uuid: string;
  author_fingerprint: string;
  content_hash: string;
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
    /** Present when the author disclosed AI assistance. */
    authoring?: { ai_assisted: AiAssisted };
    /** Present when the exported canvas was forked from another map. */
    forked_from?: ForkLineage;
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

/** DOI pattern (Crossref-recommended shape): 10.<4–9 digits>/<suffix>. */
const RE_DOI = /10\.\d{4,9}\/\S+/;

/** Fallback-rung query params that carry document identity (kept, sorted). */
const WEB_KEY_PARAMS = ["article", "id", "p"] as const;

/** Parse a query string into first-occurrence key/value pairs (no decoding). */
function queryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? "" : pair.slice(eq + 1);
    if (!params.has(k)) params.set(k, v);
  }
  return params;
}

/**
 * Normalize a source URL into a stable overlap key: `namespace:identifier`.
 * A registry-aware ladder — `doi:` / `pmid:` / `arxiv:` / `yt:` — gives the
 * same document ONE key across hosts and URL shapes; everything else falls
 * back to `web:` host+path (scheme, leading www., fragment, and trailing
 * slash dropped; lowercased) plus identity-bearing query params
 * (WEB_KEY_PARAMS, appended in sorted order). This is THE key the overlap
 * corpus joins on — "who distilled which source" — so it is derived
 * on-device and carried in every exported map, no server required.
 */
export function sourceKey(url: string): string {
  let u = (url ?? "").trim();
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme://
  u = u.replace(/^www\./i, "");
  u = u.split("#")[0];                            // fragment never carries identity
  const qIdx = u.indexOf("?");
  const hostPath = qIdx === -1 ? u : u.slice(0, qIdx);
  const query = qIdx === -1 ? "" : u.slice(qIdx + 1);
  const slash = hostPath.indexOf("/");
  const host = (slash === -1 ? hostPath : hostPath.slice(0, slash)).toLowerCase();
  const path = (slash === -1 ? "" : hostPath.slice(slash)).replace(/\/+$/, "");

  // 1. doi: — doi.org / dx.doi.org paths, or a DOI embedded in any publisher path.
  const doi = path.match(RE_DOI);
  if (doi) return `doi:${doi[0].toLowerCase().replace(/[.,;:!?)\]/]+$/, "")}`;

  // 2. pmid: — pubmed.ncbi.nlm.nih.gov/<digits>
  if (host === "pubmed.ncbi.nlm.nih.gov") {
    const m = path.match(/^\/(\d+)$/);
    if (m) return `pmid:${m[1]}`;
  }

  // 3. arxiv: — abs/pdf URL shapes; .pdf extension and version suffix stripped.
  if (host === "arxiv.org") {
    const m = path.match(/^\/(?:abs|pdf)\/(.+)$/);
    if (m) return `arxiv:${m[1].replace(/\.pdf$/i, "").replace(/v\d+$/i, "").toLowerCase()}`;
  }

  // 4. yt: — video id preserved case-sensitively across all URL shapes.
  if (host === "youtu.be") {
    const id = path.replace(/^\//, "").split("/")[0];
    if (id) return `yt:${id}`;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = queryParams(query).get("v");
    if (path === "/watch" && v) return `yt:${v}`;
    const m = path.match(/^\/(?:shorts|live)\/([^/]+)/);
    if (m) return `yt:${m[1]}`;
  }

  // 5. web: — host+path fallback plus identity-bearing query params.
  let key = `${host}${path}`.toLowerCase();
  const params = queryParams(query);
  const kept: string[] = [];
  for (const allowed of WEB_KEY_PARAMS) {
    for (const [k, v] of params) {
      if (k.toLowerCase() === allowed) { kept.push(`${allowed}=${v}`); break; }
    }
  }
  if (kept.length) key += `?${kept.join("&")}`;
  return `web:${key}`;
}

/* ═══════════════════════════════════════════════════════════════════
   Transform: Canvas -> distill.map/0.2
   ═══════════════════════════════════════════════════════════════════ */

export function transformCanvas(
  canvas: Canvas,
  meta: PublishMeta,
  clientUuid: string,
  lineage?: ForkLineage,
): TransformResult {
  const warnings: string[] = [];
  const blocking: string[] = [];
  const excluded: ExcludedNode[] = [];

  const nodes: MapNode[] = [];
  const kinds: Record<string, { kind: NodeKind }> = {};
  const includedIds = new Set<string>();

  for (const n of canvas.nodes ?? []) {
    if (n.draft) {
      // Forward-compat with LLM-drafted nodes: drafts never leave the device.
      excluded.push({ id: n.id, type: n.type, reason: "draft node (never exported)" });
      warnings.push(`Excluded draft node "${firstLine(n.text ?? "") || n.id}" — finish drafting it to publish it.`);
      continue;
    }
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
    "x-distill": {
      nodes: kinds,
      ...(meta.ai_assisted !== undefined ? { authoring: { ai_assisted: meta.ai_assisted } } : {}),
      ...(lineage ? { forked_from: lineage } : {}),
    },
    provenance: meta.provenance.map((p) => ({ ...p, source_key: p.source_key ?? sourceKey(p.url) })),
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
  // Widen the literal types: this is defense in depth over data that may not
  // actually satisfy the declared interface (e.g. parsed JSON).
  const schema: string = a.schema;
  if (schema !== "distill.map/0.2") errs.push(`Unexpected schema "${schema}".`);
  const mapFormat: string | undefined = a.map?.format;
  if (mapFormat !== "jsoncanvas/1.0") errs.push(`Unexpected map.format "${String(mapFormat)}".`);
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
  if (artifact["x-distill"].authoring) {
    lines.push(`ai_assisted: ${artifact["x-distill"].authoring.ai_assisted}`);
  }
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
    "_Exported from Thunderegg. The concept map is in the companion `.distill.json` (distill.map/0.2). Share both together._",
  );
  if (signature) {
    lines.push(
      `_Signed (${signature.algo}). Verify the exact bytes of the \`.distill.json\` against \`public_key\` above._`,
    );
  }
  return lines.join("\n");
}

/** Parse the signature block out of an exported map's sidecar frontmatter. */
export function parseSidecarSignature(md: string): ArtifactSignature | null {
  const field = (name: string): string | null => {
    const m = md.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const algo = field("signature_algo");
  const public_key = field("public_key");
  const signature = field("signature");
  if (!algo || !public_key || !signature) return null;
  return { algo, public_key, signature };
}

/* ═══════════════════════════════════════════════════════════════════
   Fork import (third-party `.distill.json` → vault) — hardening + lineage
   ═══════════════════════════════════════════════════════════════════ */

export const FORK_MAX_BYTES = 2 * 1024 * 1024;
export const FORK_MAX_NODES = 500;

/** Keep only the MapNode fields of the artifact schema; null = not a schema text node. */
function sanitizeMapNode(raw: unknown): MapNode | null {
  const n = raw as Partial<CanvasNode> | null;
  if (!n || typeof n !== "object") return null;
  if (n.type !== "text" || typeof n.id !== "string" || typeof n.text !== "string") return null;
  if (typeof n.x !== "number" || typeof n.y !== "number" || typeof n.width !== "number" || typeof n.height !== "number") return null;
  return {
    id: n.id,
    type: "text",
    x: n.x, y: n.y, width: n.width, height: n.height,
    text: n.text,
    ...(typeof n.color === "string" ? { color: n.color } : {}),
  };
}

/** Keep only the MapEdge fields of the artifact schema; null = malformed. */
function sanitizeMapEdge(raw: unknown): MapEdge | null {
  const e = raw as Partial<MapEdge> | null;
  if (!e || typeof e !== "object") return null;
  if (typeof e.id !== "string" || typeof e.fromNode !== "string" || typeof e.toNode !== "string") return null;
  return {
    id: e.id,
    fromNode: e.fromNode,
    toNode: e.toNode,
    ...(typeof e.fromSide === "string" ? { fromSide: e.fromSide } : {}),
    ...(typeof e.toSide === "string" ? { toSide: e.toSide } : {}),
    ...(typeof e.fromEnd === "string" ? { fromEnd: e.fromEnd } : {}),
    ...(typeof e.toEnd === "string" ? { toEnd: e.toEnd } : {}),
    ...(typeof e.label === "string" ? { label: e.label } : {}),
    ...(typeof e.color === "string" ? { color: e.color } : {}),
  };
}

export interface ForkMapCheck {
  /** Canvas-ready nodes (schema fields only; over-cap nodes rejected). */
  nodes: MapNode[];
  /** Canvas-ready edges (schema fields only; dangling edges dropped). */
  edges: MapEdge[];
  warnings: string[];
  blocking: string[];
}

/**
 * Harden a third-party map before it is written into the vault: node-count
 * cap, the spec's per-node text cap (over-cap nodes are REJECTED with a
 * warning listing them — never truncated), and unknown-field stripping.
 */
export function checkForkMap(map: { nodes?: unknown[]; edges?: unknown[] } | undefined): ForkMapCheck {
  const warnings: string[] = [];
  const blocking: string[] = [];

  const rawNodes = map?.nodes ?? [];
  if (rawNodes.length > FORK_MAX_NODES) {
    blocking.push(`Map has ${rawNodes.length} nodes (max ${FORK_MAX_NODES}) — refusing to import.`);
    return { nodes: [], edges: [], warnings, blocking };
  }

  const nodes: MapNode[] = [];
  const overCap: string[] = [];
  let skipped = 0;
  for (const raw of rawNodes) {
    const n = sanitizeMapNode(raw);
    if (!n) { skipped++; continue; }
    if (n.text.length > NODE_TEXT_CAP) {
      overCap.push(`"${firstLine(n.text).slice(0, 40)}…" (${n.text.length} chars)`);
      continue;
    }
    nodes.push(n);
  }
  if (skipped) warnings.push(`Skipped ${skipped} node(s) that are not schema text nodes.`);
  if (overCap.length) {
    warnings.push(`Rejected ${overCap.length} node(s) over the ${NODE_TEXT_CAP}-char cap: ${overCap.join(", ")}. The rest were imported.`);
  }
  if (nodes.length === 0) blocking.push("This map has no importable text nodes.");

  const includedIds = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  let dropped = 0;
  for (const raw of map?.edges ?? []) {
    const e = sanitizeMapEdge(raw);
    if (!e || !includedIds.has(e.fromNode) || !includedIds.has(e.toNode)) { dropped++; continue; }
    edges.push(e);
  }
  if (dropped) warnings.push(`Dropped ${dropped} edge(s) that were malformed or connected to a rejected node.`);

  return { nodes, edges, warnings, blocking };
}

/**
 * Rebuild a parsed `.distill.json` keeping ONLY the fields of the known
 * artifact schema (unknown fields at every level are stripped). Value
 * constraints (e.g. the node-text cap) are enforced by checkForkMap, not
 * here — the sanitized artifact is the fork's retained source copy.
 * Returns null when the input has no map object to speak of.
 */
export function sanitizeForkArtifact(raw: unknown): DistillMapArtifact | null {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  const map = a.map as Record<string, unknown> | null | undefined;
  if (!map || typeof map !== "object") return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const nodes: MapNode[] = [];
  for (const n of Array.isArray(map.nodes) ? map.nodes : []) {
    const s = sanitizeMapNode(n);
    if (s) nodes.push(s);
  }
  const includedIds = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  for (const e of Array.isArray(map.edges) ? map.edges : []) {
    const s = sanitizeMapEdge(e);
    if (s && includedIds.has(s.fromNode) && includedIds.has(s.toNode)) edges.push(s);
  }

  const xd = a["x-distill"] as Record<string, unknown> | undefined;
  const kinds: Record<string, { kind: NodeKind }> = {};
  const rawKinds = (xd && typeof xd === "object" ? xd.nodes ?? {} : {}) as Record<string, { kind?: unknown }>;
  for (const id of Object.keys(rawKinds)) {
    const k = rawKinds[id]?.kind;
    if (includedIds.has(id) && (k === "concept" || k === "source" || k === "question" || k === "claim")) {
      kinds[id] = { kind: k };
    }
  }
  const auth = (xd && typeof xd === "object" ? xd.authoring : undefined) as Record<string, unknown> | undefined;
  const ai = auth && typeof auth === "object" ? auth.ai_assisted : undefined;
  const authoring: { ai_assisted: AiAssisted } | undefined =
    ai === "none" || ai === "drafted" || ai === "edited" ? { ai_assisted: ai } : undefined;
  const fl = (xd && typeof xd === "object" ? xd.forked_from : undefined) as Record<string, unknown> | undefined;
  const forked_from: ForkLineage | undefined =
    fl && typeof fl === "object" &&
    typeof fl.client_uuid === "string" && typeof fl.author_fingerprint === "string" && typeof fl.content_hash === "string"
      ? { client_uuid: fl.client_uuid, author_fingerprint: fl.author_fingerprint, content_hash: fl.content_hash }
      : undefined;

  const provenance: ProvenanceEntry[] = [];
  for (const raw2 of Array.isArray(a.provenance) ? a.provenance : []) {
    const p = raw2 as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    provenance.push({
      source_title: str(p.source_title),
      url: str(p.url),
      source_type: str(p.source_type) as SourceType,
      license: str(p.license) as License,
      ...(typeof p.accessed === "string" ? { accessed: p.accessed } : {}),
      ...(typeof p.source_key === "string" ? { source_key: p.source_key } : {}),
    });
  }

  return {
    schema: "distill.map/0.2",
    client_uuid: str(a.client_uuid),
    title: str(a.title),
    summary: str(a.summary),
    topics: Array.isArray(a.topics) ? a.topics.filter((t): t is string => typeof t === "string") : [],
    visibility: (VISIBILITIES as readonly string[]).includes(str(a.visibility)) ? (a.visibility as Visibility) : "private",
    map: { format: "jsoncanvas/1.0", nodes, edges },
    "x-distill": { nodes: kinds, ...(authoring ? { authoring } : {}), ...(forked_from ? { forked_from } : {}) },
    provenance,
    license: (str(a.license) || "unknown") as License,
    distill_version: str(a.distill_version),
  };
}

export interface ForkImportPrep {
  /** Sanitized source artifact (known schema fields only) — null when blocked. */
  artifact: DistillMapArtifact | null;
  blocking: string[];
}

/** File-level gate for a fork import: size cap, JSON parse, schema strip. */
export function prepareForkImport(json: string): ForkImportPrep {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > FORK_MAX_BYTES) {
    return { artifact: null, blocking: [`File is ${bytes} bytes (max ${FORK_MAX_BYTES}) — refusing to import.`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { artifact: null, blocking: ["File is not valid JSON."] };
  }
  const artifact = sanitizeForkArtifact(raw);
  if (!artifact) return { artifact: null, blocking: ["File is not a distill map artifact (no map object)."] };
  return { artifact, blocking: [] };
}

/* ═══════════════════════════════════════════════════════════════════
   Fork attribution note + lineage receipt (pure builders/parsers)
   ═══════════════════════════════════════════════════════════════════ */

export interface ForkAttribution {
  /** Original (display) title, used in the heading. */
  displayTitle: string;
  /** Safe file base — the fork lives in `<canvasName>.canvas`. */
  canvasName: string;
  /** What the fork points back to: server map id, or the source map's client_uuid. */
  forkedFrom: string;
  /** Original author: handle (server forks) or signing-key fingerprint (file forks). */
  author: string;
  license: string;
  /** Server link, or the vault path of the source `.distill.json`. */
  sourceUrl: string;
  /** File forks: signed lineage receipt, recorded in the frontmatter. */
  lineage?: ForkLineage;
}

/** The companion attribution note written next to every forked canvas. */
export function buildAttributionNote(a: ForkAttribution): string {
  const lines: string[] = [
    "---",
    `forked_from: ${a.forkedFrom}`,
    `author: ${a.author}`,
    `license: ${a.license}`,
    `source_url: ${a.sourceUrl}`,
  ];
  if (a.lineage) {
    lines.push(
      `lineage_client_uuid: ${a.lineage.client_uuid}`,
      `lineage_author_fingerprint: ${a.lineage.author_fingerprint}`,
      `lineage_content_hash: ${a.lineage.content_hash}`,
    );
  }
  lines.push(
    "---",
    "",
    `# ${a.displayTitle} (forked)`,
    "",
    `Forked from [@${a.author}](${a.sourceUrl}). License: ${a.license}.`,
    "",
    `The map is in \`${a.canvasName}.canvas\` in this folder.`,
    "",
  );
  return lines.join("\n");
}

/** Parse the lineage receipt out of a fork's attribution-note frontmatter. */
export function parseLineageFrontmatter(md: string): ForkLineage | null {
  const field = (name: string): string | null => {
    const m = md.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const client_uuid = field("lineage_client_uuid");
  const author_fingerprint = field("lineage_author_fingerprint");
  const content_hash = field("lineage_content_hash");
  if (!client_uuid || !author_fingerprint || !content_hash) return null;
  return { client_uuid, author_fingerprint, content_hash };
}

/**
 * Short markdown snippet for zero-telemetry self-report of a fork (Discord/
 * forums): title, author fingerprint, source_key(s), content_hash prefix.
 */
export function buildForkReceipt(artifact: DistillMapArtifact, lineage: ForkLineage): string {
  const sources = artifact.provenance
    .map((p) => p.source_key ?? sourceKey(p.url))
    .filter((s) => s && s !== "web:");
  const lines: string[] = [
    `Forked "${artifact.title}" via Thunderegg`,
    `- author: \`${lineage.author_fingerprint}\``,
    `- content: \`${lineage.content_hash.slice(0, 12)}…\``,
  ];
  if (sources.length) lines.push(`- sources: ${sources.map((s) => `\`${s}\``).join(", ")}`);
  return lines.join("\n");
}
