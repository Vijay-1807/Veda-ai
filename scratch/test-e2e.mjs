#!/usr/bin/env node
/**
 * End-to-end extraction test using real image files via the running dev server.
 * Usage: node scratch/test-e2e.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SERVER = process.env.SERVER_URL ?? "http://localhost:3001";

// Find test images
const candidates = [
  ["image11.png", "image12.png"],
  ["DPS logo.png", "DPS logo.png"],
];

let paperPath = "";
let answerPath = "";

for (const [p, a] of candidates) {
  const pp = resolve(ROOT, p);
  const ap = resolve(ROOT, a);
  if (existsSync(pp) && existsSync(ap)) {
    paperPath = pp;
    answerPath = ap;
    console.log(`Using: paper=${p}, answers=${a}`);
    break;
  }
}

if (!paperPath) {
  console.error("No test images found. Place image11.png and image12.png in the project root.");
  process.exit(1);
}

const paperBuf = readFileSync(paperPath);
const answerBuf = readFileSync(answerPath);

const form = new FormData();
form.append("paper", new Blob([paperBuf], { type: "image/png" }), "paper.png");
form.append("answers", new Blob([answerBuf], { type: "image/png" }), "answers.png");

console.log(`\nPOST ${SERVER}/api/extract ...`);
const t0 = Date.now();

const res = await fetch(`${SERVER}/api/extract`, {
  method: "POST",
  body: form,
});

const elapsed = Date.now() - t0;
console.log(`\nHTTP ${res.status} in ${elapsed}ms`);

const body = await res.json();

if (!res.ok) {
  console.error("FAILED:", body.error?.slice(0, 300));
  console.error("Details:", body.details?.slice(0, 3));
  process.exit(1);
}

const { questions, answers, provider, ocrAssisted } = body;
console.log(`
PRIMARY PROVIDER: ${provider}
LATENCY:          ${elapsed}ms
QUESTIONS:        ${questions?.length ?? 0}
ANSWERS:          ${answers?.length ?? 0}
OCR USED:         ${ocrAssisted ?? false}
`);

// Validate bboxes
let bboxOk = 0, bboxBad = 0;
for (const q of (questions ?? [])) {
  if (q.bbox) {
    const [x1,y1,x2,y2] = q.bbox;
    if (x1>=0 && y1>=0 && x2<=1 && y2<=1 && x2>x1 && y2>y1) bboxOk++;
    else bboxBad++;
  }
}
for (const a of (answers ?? [])) {
  for (const r of (a.regions ?? [])) {
    const [x1,y1,x2,y2] = r.bbox ?? [];
    if (x1>=0 && y1>=0 && x2<=1 && y2<=1 && x2>x1 && y2>y1) bboxOk++;
    else bboxBad++;
  }
}

console.log(`BBOX VALID:  ${bboxOk}`);
console.log(`BBOX INVALID: ${bboxBad}`);

if (questions?.length > 0) {
  console.log(`\nSample questions:`);
  for (const q of questions.slice(0, 5)) {
    console.log(`  [${q.number}] ${q.text?.slice(0, 60)} (conf=${q.confidence})`);
  }
}

if (bboxBad > 0) {
  console.warn(`\n⚠️  ${bboxBad} invalid bboxes detected`);
} else {
  console.log(`\n✅ All bboxes valid`);
}
