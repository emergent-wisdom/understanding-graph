#!/usr/bin/env node
/**
 * graph-consequence — measure whether a graph was a medium or a filing cabinet.
 *
 *   node scripts/graph-consequence.mjs <path-to-store.db>
 *
 * Volume is not the interesting question. A graph with 200 cognitive nodes
 * that never shaped anything is worse than one with 16 that all did. These
 * metrics ask what the architecture actually claims:
 *
 *   1. Composition    — cognitive vs artifact nodes, and the ratio's caveat.
 *   2. Consequence    — did preserved understanding reach the artifact?
 *   3. Spiral         — did LATER work reach back to EARLIER understanding?
 *                       This is the re-entry claim; without it the graph is
 *                       an archive, not a medium.
 *   4. Granularity    — artifact leaf sizes, i.e. is prose addressable?
 *   5. Orphans        — cognitive nodes connected to nothing.
 *
 * Read-only. Safe to run against a live store.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const dbPath = process.argv[2];
if (!dbPath || !existsSync(dbPath)) {
  console.error('usage: node scripts/graph-consequence.mjs <path-to-store.db>');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const q = (sql, ...args) => db.prepare(sql).all(...args);

// Document (artifact) nodes are written with why='Document node'; every other
// active node is ordinary cognitive testimony. Reserved synthetic `thinking`
// blocks are excluded — they belong to the CMP extension, not ordinary work.
const ARTIFACT = `(why = 'Document node')`;
const COGNITIVE = `(COALESCE(why,'') <> 'Document node' AND COALESCE(trigger,'') <> 'thinking')`;

// NOTE: for document nodes `understanding` is only a ~200-char preview used
// for search and display; the full prose lives in `content`. Measuring the
// preview badly understates artifact size — read `content` for artifacts.
const nodes = q(`
  SELECT id, title, trigger, why, understanding, content, created_at,
         CASE WHEN ${ARTIFACT} THEN 'artifact' ELSE 'cognitive' END AS kind
  FROM nodes WHERE active = 1
`);
const edges = q(
  `SELECT id, from_id, to_id, type, created_at FROM edges WHERE active = 1`,
);
const commits = q(
  `SELECT id, message, author, node_ids, edge_ids, created_at
   FROM commits ORDER BY created_at ASC`,
);

const artifacts = nodes.filter((n) => n.kind === 'artifact');
const cognitive = nodes.filter((n) => n.kind === 'cognitive');
const byId = new Map(nodes.map((n) => [n.id, n]));

// Which commit introduced each node. Later work reaching back across a commit
// boundary is the observable trace of re-entry.
const commitOfNode = new Map();
commits.forEach((c, i) => {
  for (const id of JSON.parse(c.node_ids || '[]')) {
    if (!commitOfNode.has(id)) commitOfNode.set(id, i);
  }
});
const commitOfEdge = new Map();
commits.forEach((c, i) => {
  for (const id of JSON.parse(c.edge_ids || '[]')) {
    if (!commitOfEdge.has(id)) commitOfEdge.set(id, i);
  }
});

const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}%`);
const line = (label, value, note = '') =>
  console.log(`  ${label.padEnd(34)} ${String(value).padStart(8)}  ${note}`);

console.log(`\n\x1b[1mgraph-consequence\x1b[0m  ${dbPath}\n`);

/* ── 1. Composition ─────────────────────────────────────────────── */
console.log('\x1b[1mCOMPOSITION\x1b[0m');
line('cognitive nodes', cognitive.length);
line('artifact nodes', artifacts.length);
line(
  'cognitive : artifact',
  artifacts.length ? `1:${(artifacts.length / cognitive.length).toFixed(1)}` : '—',
  'not a quality signal on its own',
);
const triggers = {};
for (const n of cognitive) triggers[n.trigger || '(none)'] = (triggers[n.trigger || '(none)'] || 0) + 1;
console.log(
  `  ${'kinds'.padEnd(34)} ${Object.entries(triggers)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}:${c}`)
    .join(' ')}`,
);
console.log(
  '  \x1b[2mnote: finer artifact granularity inflates the denominator, so this\n' +
    '  ratio moves without any change in how much was understood.\x1b[0m',
);

/* ── 2. Consequence ─────────────────────────────────────────────── */
// Did preserved understanding actually reach produced work? inspired_by is
// the author's own claim of influence; expresses/implements are structural.
const INFLUENCE = new Set(['inspired_by', 'expresses', 'implements']);
const influenceEdges = edges.filter((e) => INFLUENCE.has(e.type));
const cognitiveThatShaped = new Set(
  influenceEdges
    .flatMap((e) => [e.from_id, e.to_id])
    .filter((id) => byId.get(id)?.kind === 'cognitive'),
);
console.log('\n\x1b[1mCONSEQUENCE\x1b[0m  \x1b[2m(did understanding reach the work?)\x1b[0m');
line('influence edges', influenceEdges.length, influenceEdges.length ? `types: ${[...new Set(influenceEdges.map((e) => e.type))].join(', ')}` : '');
line(
  'cognitive nodes that shaped work',
  `${cognitiveThatShaped.size}/${cognitive.length}`,
  pct(cognitiveThatShaped.size, cognitive.length) + ' conversion',
);

/* ── 3. Spiral ──────────────────────────────────────────────────── */
// The central claim: committing an update and re-entering changes later work.
// Observable trace = an edge created in a later commit than the node it
// points at. Same-commit links are just this pass wiring itself up.
let reachBack = 0;
const reachBackDetail = [];
for (const e of edges) {
  const ec = commitOfEdge.get(e.id);
  if (ec === undefined) continue;
  for (const endpoint of [e.from_id, e.to_id]) {
    const nc = commitOfNode.get(endpoint);
    if (nc !== undefined && nc < ec) {
      reachBack++;
      reachBackDetail.push({
        type: e.type,
        span: ec - nc,
        target: byId.get(endpoint)?.title?.slice(0, 44) ?? endpoint,
      });
      break;
    }
  }
}
const spanned = new Set(reachBackDetail.map((d) => d.target));
console.log('\n\x1b[1mSPIRAL\x1b[0m  \x1b[2m(did later work reach back to earlier understanding?)\x1b[0m');
line('commits', commits.length);
line('cross-commit edges', reachBack, pct(reachBack, edges.length) + ' of all edges');
line('distinct earlier nodes reused', spanned.size);
line(
  'max commit span',
  reachBackDetail.length ? Math.max(...reachBackDetail.map((d) => d.span)) : 0,
  'commits between authoring and reuse',
);
for (const d of reachBackDetail.sort((a, b) => b.span - a.span).slice(0, 6)) {
  console.log(`    \x1b[2m+${d.span} commit(s)  ${d.type.padEnd(14)} → ${d.target}\x1b[0m`);
}
if (reachBack === 0) {
  console.log(
    '    \x1b[33mno cross-commit reuse: this graph is an archive, not a spiral\x1b[0m',
  );
}

/* ── 4. Granularity ─────────────────────────────────────────────── */
// Artifact leaves should be independently revisable. Oversized leaves mean a
// future writer must rewrite a whole block to change one beat.
const hasChild = new Set(
  edges.filter((e) => e.type === 'contains').map((e) => e.from_id),
);
const leaves = artifacts.filter((n) => !hasChild.has(n.id));
const prose = (n) => n.content || '';
const words = leaves
  .map((n) => prose(n).trim().split(/\s+/).filter(Boolean).length)
  .sort((a, b) => a - b);
const median = words.length ? words[Math.floor(words.length / 2)] : 0;
const paras = leaves.map(
  (n) => prose(n).split(/\n\s*\n/).filter((p) => p.trim()).length,
);
const multiPara = paras.filter((p) => p > 1).length;
console.log('\n\x1b[1mGRANULARITY\x1b[0m  \x1b[2m(is the prose independently revisable?)\x1b[0m');
line('artifact leaves', leaves.length);
line('total words', words.reduce((a, b) => a + b, 0));
line('median words / leaf', median);
line('largest leaf', words.length ? words[words.length - 1] : 0, 'words');
line(
  'leaves with >1 paragraph',
  `${multiPara}/${leaves.length}`,
  pct(multiPara, leaves.length) + ' — each is a block a future writer cannot split',
);

/* ── 5. Orphans ─────────────────────────────────────────────────── */
const connected = new Set(edges.flatMap((e) => [e.from_id, e.to_id]));
const orphans = cognitive.filter((n) => !connected.has(n.id));
console.log('\n\x1b[1mORPHANS\x1b[0m');
line('unconnected cognitive nodes', `${orphans.length}/${cognitive.length}`);
for (const o of orphans.slice(0, 5)) {
  console.log(`    \x1b[2m${o.trigger ?? '?'} — ${(o.title || '').slice(0, 56)}\x1b[0m`);
}

console.log();
db.close();
