// Isolated process to measure the old number-array/JSON cost on a 100 MB output.
// Run after the opt-in largeExport test: node --expose-gc scripts/benchmark-export-bridge.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const path = 'internal_docs/performance-qa/large-32-pages_Marked.pdf';
const bytes = new Uint8Array(readFileSync(path));
global.gc?.();
const before = process.memoryUsage();
const start = performance.now();
const array = Array.from(bytes);
const converted = performance.now();
const json = JSON.stringify({ bytes: array });
const end = performance.now();
const after = process.memoryUsage();
const report = {
  caveat: 'Node.js serialization microbenchmark; excludes WebView IPC transmission, Rust JSON parsing and disk I/O',
  binaryBytes: bytes.byteLength, oldJsonBytes: Buffer.byteLength(json),
  arrayConversionMs: Math.round(converted - start), jsonSerializationMs: Math.round(end - converted),
  oldPreparationMs: Math.round(end - start),
  heapGrowthBytes: after.heapUsed - before.heapUsed, rssGrowthBytes: after.rss - before.rss,
};
writeFileSync('internal_docs/performance-qa/bridge-benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
