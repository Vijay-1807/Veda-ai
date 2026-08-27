import assert from "node:assert/strict";
import { normalizeOcrPoints, parseNvidiaOcrResponse } from "../lib/ai/nemotron-ocr";
import { evaluateQuality, enrichWithOcrBboxes, extractAnswersFromOcr } from "../lib/ai/ocr-quality";
import { normalizeQuestionIdentity, normalizeQuestionNumber, type Question, type Answer } from "../lib/types";
import { mapAnswers } from "../lib/mapping";

console.log("▶ Running OCR & Normalization Integration Tests...");

// ── 1. OCR Bounding Box Normalization & Clamping ───────────────
console.log("  [Test 1] OCR Point Normalization & Clamping...");

const samplePoints = [
  { x: 0.12, y: 0.34 },
  { x: 0.88, y: 0.34 },
  { x: 0.88, y: 0.52 },
  { x: 0.12, y: 0.52 },
];
const bbox = normalizeOcrPoints(samplePoints);
assert.deepEqual(bbox, [0.12, 0.34, 0.88, 0.52]);

// Test out-of-bounds clamping
const outOfBounds = [
  { x: -0.1, y: -0.05 },
  { x: 1.5, y: 1.2 },
];
const clampedBbox = normalizeOcrPoints(outOfBounds);
assert.deepEqual(clampedBbox, [0, 0, 1, 1]);

// Test invalid / null / non-finite points
assert.equal(normalizeOcrPoints(null), null);
assert.equal(normalizeOcrPoints([]), null);
assert.equal(normalizeOcrPoints([{ x: NaN, y: 0.5 }]), null);

// ── 2. OCR Response Parsing & Reading Order ───────────────────
console.log("  [Test 2] NVIDIA Raw Response Parsing & Sorting...");

const rawNvidiaResponse = {
  data: [
    {
      index: 0,
      text_detections: [
        {
          text_prediction: { text: "Second line of text", confidence: 0.92 },
          bounding_box: {
            points: [{ x: 0.1, y: 0.4 }, { x: 0.9, y: 0.4 }, { x: 0.9, y: 0.5 }, { x: 0.1, y: 0.5 }],
          },
        },
        {
          text_prediction: { text: "First line of text", confidence: 0.96 },
          bounding_box: {
            points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.1, y: 0.2 }],
          },
        },
      ],
    },
  ],
};

const pageResult = parseNvidiaOcrResponse(rawNvidiaResponse, 3);
assert.equal(pageResult.page, 3, "Original PDF page number must be preserved");
assert.equal(pageResult.blocks.length, 2);
assert.equal(pageResult.blocks[0].text, "First line of text", "Blocks must be sorted top-to-bottom");
assert.equal(pageResult.blocks[1].text, "Second line of text");
assert.equal(pageResult.averageConfidence, 0.94);

// ── 3. OCR Quality Gating Logic ───────────────────────────────
console.log("  [Test 3] Quality Gating (Conditional OCR Trigger)...");

const makeQ = (num: string, text = "Valid question text here"): Question => ({
  id: `q-${num}`,
  number: num,
  originalLabel: num,
  normalizedNumber: normalizeQuestionNumber(num),
  identity: normalizeQuestionIdentity(num),
  text,
  page: 1,
  confidence: 0.95,
  marks: 2,
  bbox: [0.1, 0.1, 0.9, 0.2],
});

const makeA = (id: string, num: string, bbox: [number, number, number, number] = [0.1, 0.2, 0.9, 0.4]): Answer => ({
  id,
  questionNumber: num,
  originalLabel: num,
  normalizedQuestionNumber: normalizeQuestionNumber(num),
  identity: normalizeQuestionIdentity(num),
  text: "Answer content",
  regions: [{ page: 1, bbox, confidence: 0.9 }],
  confidence: 0.9,
});

// Clean extraction -> Quality gate must PASS (no OCR triggered)
const cleanExtraction = evaluateQuality(
  [makeQ("21"), makeQ("22"), makeQ("23")],
  [makeA("a1", "21"), makeA("a2", "22"), makeA("a3", "23")]
);
assert.equal(cleanExtraction.ok, true, "Clean extraction must pass quality gate");

// Incomplete questions -> Quality gate must FAIL (triggers OCR recovery)
const emptyQExtraction = evaluateQuality(
  [makeQ("21", ""), makeQ("22", ""), makeQ("23", "")],
  [makeA("a1", "21")]
);
assert.equal(emptyQExtraction.ok, false, "Empty question text must fail quality gate");

// Missing/degenerate bboxes on ALL answers -> Quality gate must FAIL
const allDegenerateBbox = evaluateQuality(
  [makeQ("21")],
  [
    makeA("a1", "21", [0.5, 0.5, 0.5, 0.5]), // zero-area
    makeA("a2", "22", [0.5, 0.5, 0.5, 0.5]), // zero-area
  ]
);
assert.equal(allDegenerateBbox.ok, false, "Majority degenerate bboxes must fail quality gate");

// ── 4. OCR Bounding Box Fallback Enrichment ───────────────────
console.log("  [Test 4] OCR Bounding Box Fallback Enrichment...");

const answersWithMissingBbox: Answer[] = [
  {
    id: "a1",
    questionNumber: "41(b)",
    originalLabel: "41(b)",
    text: "Reflected ray angle calculation",
    regions: [{ page: 1, bbox: [0, 0, 1, 1], confidence: 0.4 }], // default fallback bbox
    confidence: 0.5,
  },
];

const mockOcrResult = {
  pages: [
    {
      page: 1,
      blocks: [
        { text: "41(b) Reflected ray angle", bbox: [0.1, 0.45, 0.9, 0.65] as [number, number, number, number], confidence: 0.95 },
      ],
      fullText: "41(b) Reflected ray angle",
      averageConfidence: 0.95,
    },
  ],
  totalBlocks: 1,
  overallConfidence: 0.95,
};

const enriched = enrichWithOcrBboxes(answersWithMissingBbox, mockOcrResult);
assert.deepEqual(enriched[0].regions[0].bbox, [0.1, 0.45, 0.9, 0.65], "Missing bbox should adopt OCR coordinates");
assert.equal(enriched[0].regions[0].confidence, 0.95);

// ── 5. Structural Question Identity Collision Safety ───────────
console.log("  [Test 5] Question Subpart Identity Safety...");

const distinctTests = [
  ["41(a)", "41(b)"],
  ["41(i)", "41(ii)"],
  ["41(1)", "41(2)"],
  ["41.1", "41.1.1"],
  ["2", "22"],
  ["11", "111"],
];

for (const [a, b] of distinctTests) {
  const normA = normalizeQuestionNumber(a);
  const normB = normalizeQuestionNumber(b);
  assert.notEqual(normA, normB, `${a} and ${b} must have distinct normalized identities`);
}

// ── 6. Mapping with Out-of-Order Answers ──────────────────────
console.log("  [Test 6] Out-of-Order Answer Mapping...");

const mappedResult = mapAnswers(
  [makeQ("41(a)"), makeQ("41(b)"), makeQ("22")],
  [makeA("ans-b", "41(b)"), makeA("ans-a", "41(a)"), makeA("ans-2", "2")]
);

assert.equal(mappedResult.mapped[0].answer?.id, "ans-a");
assert.equal(mappedResult.mapped[1].answer?.id, "ans-b");
assert.equal(mappedResult.mapped[2].answer, null, "Question 22 must NOT match answer 2");
assert.equal(mappedResult.unmatched.length, 1);
assert.equal(mappedResult.unmatched[0].id, "ans-2");

const segmented = extractAnswersFromOcr({
  pages: [{ page: 1, blocks: [
    { text: "41(b) diagram", bbox: [0.08, 0.1, 0.9, 0.25], confidence: 0.9 },
    { text: "33. next answer", bbox: [0.08, 0.3, 0.9, 0.4], confidence: 0.9 },
    { text: "11(b) another answer", bbox: [0.08, 0.45, 0.9, 0.55], confidence: 0.9 },
  ], fullText: "", averageConfidence: 0.9 }], totalBlocks: 3, overallConfidence: 0.9,
}, [makeQ("41(b)"), makeQ("33"), makeQ("11(b)")]);
assert.equal(segmented.length, 3);
assert.ok(segmented[0].regions[0].bbox[3] < segmented[1].regions[0].bbox[1]);

// ── 7. Bbox Sanitization & Fault Tolerance ────────────────────
console.log("  [Test 7] Bbox Sanitization & Fault Tolerance...");

import { sanitizeBbox, normalizeExtraction } from "../lib/ai/provider";

// Reversed coordinates
const reversed = sanitizeBbox([0.88, 0.52, 0.12, 0.34]);
assert.deepEqual(reversed, [0.12, 0.34, 0.88, 0.52]);

// Out of bounds
const outBounds = sanitizeBbox([-0.2, -0.1, 1.5, 1.2]);
assert.deepEqual(outBounds, [0, 0, 1, 1]);

// Strings
const stringBbox = sanitizeBbox(["0.1", "0.2", "0.8", "0.5"]);
assert.deepEqual(stringBbox, [0.1, 0.2, 0.8, 0.5]);

// Zero-area expanded safely
const zeroArea = sanitizeBbox([0.5, 0.5, 0.5, 0.5]);
assert.ok(zeroArea !== undefined);
assert.ok(zeroArea[0] < zeroArea[2]);
assert.ok(zeroArea[1] < zeroArea[3]);

// Unusable / non-finite -> returns undefined
assert.equal(sanitizeBbox(null), undefined);
assert.equal(sanitizeBbox([NaN, 0, 1, 1]), undefined);
assert.equal(sanitizeBbox([0.1, 0.2]), undefined);

// Single malformed bbox in 20 questions -> all 20 must survive without throwing!
const mock20Questions = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i + 1}`,
  number: `${21 + i}`,
  originalLabel: `${21 + i}`,
  normalizedNumber: `${21 + i}`,
  page: 1,
  // Question 15 has an invalid/malformed bbox
  bbox: i === 15 ? [0.5, 0.5, 0.5, 0.5] : [0.12, 0.35, 0.88, 0.38],
  marks: 2,
  confidence: 0.98,
}));

const normalized = normalizeExtraction({ questions: mock20Questions, answers: [] });
assert.equal(normalized.questions.length, 20, "All 20 questions must survive even if item 15 has malformed bbox");
assert.equal(normalized.questions[15].number, "36");

// ── 8. Model JSON Parsing Resilience ─────────────────────────
console.log("  [Test 8] Model JSON Parsing Resilience...");

import { parseModelJson } from "../lib/ai/provider";

// Clean JSON
const clean = parseModelJson('{"questions":[{"id":"q1","number":"1","page":1}]}');
assert.ok(clean && typeof clean === "object");

// Inside markdown codeblock ```json ... ```
const mdBlock = parseModelJson('```json\n{"answers":[{"id":"a1","questionNumber":"25","originalLabel":"25.","regions":[{"page":1,"bbox":[0.02,0.08,0.95,0.14],"confidence":0.98}],"confidence":0.98}]}\n```');
assert.ok(mdBlock && typeof mdBlock === "object");

// Unclosed markdown codeblock
const unclosedMd = parseModelJson('```json\n{"answers":[{"id":"a1","questionNumber":"25","text":"Line 1\\nLine 2"}]}');
assert.ok(unclosedMd && typeof unclosedMd === "object");

// With reasoning/think tags
const thinkTag = parseModelJson('<think>Thinking process here...</think>```json\n{"questions":[{"id":"q1","number":"1"}]}\n```');
assert.ok(thinkTag && typeof thinkTag === "object");

console.log("✔ All OCR and Normalization Integration Tests Passed!\n");
