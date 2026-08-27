#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const SERVER = process.env.SERVER_URL ?? "http://localhost:3001";

const paperPath = "C:\\Users\\Bonth\\Downloads\\image11.png";
const answerPath = "C:\\Users\\Bonth\\Downloads\\image12.png";

if (!existsSync(paperPath) || !existsSync(answerPath)) {
  console.error("Test files not found:", { paperPath, answerPath });
  process.exit(1);
}

const paperBuf = readFileSync(paperPath);
const answerBuf = readFileSync(answerPath);

const form = new FormData();
form.append("paper", new Blob([paperBuf], { type: "image/png" }), "image11.png");
form.append("answers", new Blob([answerBuf], { type: "image/png" }), "image12.png");

console.log(`\n==================================================`);
console.log(`POST ${SERVER}/api/extract with image11.png + image12.png`);
console.log(`==================================================\n`);

const t0 = Date.now();

try {
  const res = await fetch(`${SERVER}/api/extract`, {
    method: "POST",
    body: form,
  });

  const elapsed = Date.now() - t0;
  console.log(`\nHTTP ${res.status} in ${elapsed}ms\n`);

  const body = await res.json();

  if (!res.ok) {
    console.error("❌ EXTRACTION FAILED:");
    console.error("Error:", body.error);
    console.error("Details:", JSON.stringify(body.details, null, 2));
    process.exit(1);
  }

  const { questions, answers, provider, questionProvider, answerProvider, ocrProvider, ocrEngine,
    questionCount, answerCount, mappedCount, unansweredCount, unmatchedCount, uncertainCount,
    bboxValid, bboxInvalid, crossAnswerViolations, totalApiCalls,
    questionLatencyMs, answerLatencyMs, ocrLatencyMs, totalLatencyMs,
    detectedAnswerLabels, missingAnswers, duplicateAnswers, requiredMappings,
    initialAnswerCount, bboxRepairCount, semanticRecoveryCount, repairedAnswerLabels, ocrRecoveryLatencyMs,
    ocrAssisted } = body;

  console.log(`==================================================`);
  console.log(`EXTRACTION SUCCESS REPORT`);
  console.log(`==================================================`);
  console.log(`PROVIDER:         ${provider}`);
  console.log(`QUESTION PROVIDER: ${questionProvider}`);
  console.log(`ANSWER PROVIDER:   ${answerProvider}`);
  console.log(`OCR PROVIDER:      ${ocrProvider || ocrEngine || "none"}`);
  console.log(`TOTAL LATENCY:    ${elapsed}ms`);
  console.log(`QUESTIONS COUNT:  ${questions?.length ?? 0}`);
  console.log(`ANSWERS COUNT:    ${answers?.length ?? 0}`);
  console.log(`MAPPED COUNT:     ${mappedCount ?? "not returned"}`);
  console.log(`UNANSWERED COUNT: ${unansweredCount ?? "not returned"}`);
  console.log(`UNMATCHED COUNT:  ${unmatchedCount ?? "not returned"}`);
  console.log(`UNCERTAIN COUNT:  ${uncertainCount ?? "not returned"}`);
  console.log(`BBOX VALID:       ${bboxValid ?? "not returned"}`);
  console.log(`BBOX INVALID:     ${bboxInvalid ?? "not returned"}`);
  console.log(`CROSS VIOLATIONS: ${crossAnswerViolations ?? "not returned"}`);
  console.log(`TOTAL API CALLS:  ${totalApiCalls ?? "not returned"}`);
  console.log(`QUESTION LATENCY: ${questionLatencyMs ?? "not returned"}ms`);
  console.log(`ANSWER LATENCY:   ${answerLatencyMs ?? "not returned"}ms`);
  console.log(`OCR LATENCY:      ${ocrLatencyMs ?? "not returned"}ms`);
  console.log(`TOTAL API LATENCY:${totalLatencyMs ?? elapsed}ms`);
  console.log(`INITIAL ANSWERS:  ${initialAnswerCount ?? "not returned"}`);
  console.log(`BBOX REPAIRS:     ${bboxRepairCount ?? "not returned"}`);
  console.log(`SEMANTIC RECOVERY:${semanticRecoveryCount ?? "not returned"}`);
  console.log(`REPAIRED LABELS:  ${JSON.stringify(repairedAnswerLabels ?? [])}`);
  console.log(`RECOVERY LATENCY: ${ocrRecoveryLatencyMs ?? "not returned"}ms`);
  console.log(`OCR USED:         ${ocrAssisted ? "YES" : "NO"}`);
  if (ocrLatencyMs) console.log(`OCR LATENCY:      ${ocrLatencyMs}ms`);
  console.log(`==================================================\n`);
  console.log(`DETECTED LABELS:  ${JSON.stringify(detectedAnswerLabels ?? [])}`);
  console.log(`MISSING LABELS:   ${JSON.stringify(missingAnswers ?? [])}`);
  console.log(`DUPLICATE LABELS: ${JSON.stringify(duplicateAnswers ?? [])}`);
  for (const label of ["41a", "41b", "33", "35", "52b", "37"]) {
    console.log(`MAPPING ${label}:  ${JSON.stringify(requiredMappings?.[label] ?? null)}`);
  }

  let validBbox = 0;
  let omittedBbox = 0;
  let invalidBbox = 0;

  for (const q of (questions ?? [])) {
    if (!q.bbox) {
      omittedBbox++;
    } else {
      const [x1, y1, x2, y2] = q.bbox;
      if (x1 < x2 && y1 < y2 && x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1) {
        validBbox++;
      } else {
        invalidBbox++;
      }
    }
  }

  for (const a of (answers ?? [])) {
    for (const r of (a.regions ?? [])) {
      const [x1, y1, x2, y2] = r.bbox ?? [];
      if (x1 < x2 && y1 < y2 && x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1) {
        validBbox++;
      } else {
        invalidBbox++;
      }
    }
  }

  console.log(`BBOX VALID:   ${validBbox}`);
  console.log(`BBOX OMITTED: ${omittedBbox}`);
  console.log(`BBOX INVALID: ${invalidBbox}`);

  console.log(`\nSample extracted questions:`);
  for (const q of (questions ?? []).slice(0, 5)) {
    console.log(`  [Q${q.number}] (${q.marks ?? "?"} marks) ${q.text?.slice(0, 70)} (bbox: ${JSON.stringify(q.bbox)})`);
  }

  console.log(`\nSample extracted answers:`);
  for (const a of (answers ?? []).slice(0, 5)) {
    console.log(`  [A${a.questionNumber}] ${a.text?.slice(0, 70)} (regions: ${a.regions?.length})`);
  }

} catch (err) {
  console.error("Network or fetch error:", err);
  process.exit(1);
}
