#!/usr/bin/env node
/**
 * Microbenchmark — note editor content sync hot path.
 *
 * Simulates the cost of the "resync useEffect" in NoteEditor.tsx on
 * every Redux round-trip (one per debounced keystroke, ~3–4 per sec
 * of active typing). Compares two paths:
 *
 *   OLD: JSON.stringify(editor.getJSON()) then string-compare.
 *        Runs on every effect fire, O(n) in note size.
 *
 *   NEW: note.content === lastSyncedRef.current (identity compare
 *        when Redux round-trips the same string reference back). O(1).
 *
 * Run:  node scripts/bench-note-editor-sync.mjs
 */

import { performance } from 'node:perf_hooks';

function makeDoc(paragraphCount) {
  const content = [];
  for (let i = 0; i < paragraphCount; i++) {
    content.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Paragraph ${i}: ${'lorem ipsum dolor sit amet '.repeat(20)}`,
        },
      ],
    });
  }
  return { type: 'doc', content };
}

function benchOld(docObj, noteContent, iterations) {
  // Approximates `JSON.stringify(editor.getJSON()) !== note.content`.
  // editor.getJSON() in TipTap walks the ProseMirror doc and is itself
  // O(n); here we pass a pre-built object to isolate JSON.stringify
  // cost, which is the dominant term in practice.
  let sink = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const currentContent = JSON.stringify(docObj);
    if (noteContent !== currentContent) sink++;
  }
  const elapsed = performance.now() - start;
  return { elapsed, sink };
}

function benchNew(noteContent, cachedRef, iterations) {
  // Approximates `note.content === lastSyncedContentRef.current`.
  // On a genuine round-trip both sides point to the same String
  // primitive and V8 short-circuits via identity.
  let sink = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    if (noteContent !== cachedRef) sink++;
  }
  const elapsed = performance.now() - start;
  return { elapsed, sink };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(ms) {
  if (ms >= 1) return `${ms.toFixed(3)} ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(2)} µs`;
  return `${(ms * 1_000_000).toFixed(1)} ns`;
}

const sizes = [
  { name: 'tiny', paragraphs: 5 },
  { name: 'short', paragraphs: 50 },
  { name: 'medium', paragraphs: 500 },
  { name: 'long', paragraphs: 2_000 },
  { name: 'huge', paragraphs: 10_000 },
  { name: 'epic', paragraphs: 50_000 },
];

console.log(
  '\nNote editor sync — per-effect-fire cost (one fire per debounced keystroke, ~3–4/sec of typing).\n'
);
console.log(
  'size     paragraphs   json         OLD per op      NEW per op      speed-up       OLD @ 4/sec'
);
console.log(
  '-----    ----------   ---------    ------------    ------------    -----------    ------------'
);

for (const { name, paragraphs } of sizes) {
  const doc = makeDoc(paragraphs);
  const json = JSON.stringify(doc);
  const byteSize = Buffer.byteLength(json, 'utf8');

  // Aim for ~100ms of total wall-clock per measurement — iteration
  // count scales inversely with payload size so tiny docs don't
  // run forever and huge docs aren't measured on 2 ops.
  const iter = Math.max(50, Math.min(50_000, Math.floor(2_000_000 / Math.sqrt(byteSize))));

  // Warm up JIT before measuring.
  benchOld(doc, json, Math.min(20, iter));
  benchNew(json, json, Math.min(20, iter));

  const oldRun = benchOld(doc, json, iter);
  const newRun = benchNew(json, json, iter);

  const oldPerOp = oldRun.elapsed / iter;
  const newPerOp = newRun.elapsed / iter;
  const speedup = oldPerOp / Math.max(newPerOp, 1e-9);
  const oldPerSecOfTyping = oldPerOp * 4; // 4 effect fires per sec

  console.log(
    `${name.padEnd(8)} ${String(paragraphs).padStart(10)}   ${fmtBytes(byteSize).padEnd(
      10
    )}   ${fmtTime(oldPerOp).padEnd(14)}  ${fmtTime(newPerOp).padEnd(14)}  ${speedup
      .toFixed(0)
      .padStart(6)}×       ${fmtTime(oldPerSecOfTyping)}`
  );
}

console.log(
  '\nOLD = JSON.stringify(doc) + string compare   NEW = ref/identity compare'
);
console.log(
  '"OLD @ 4/sec" ≈ main-thread time per second of typing spent on this one hot path alone.\n'
);
