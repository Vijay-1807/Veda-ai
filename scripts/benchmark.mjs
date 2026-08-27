#!/usr/bin/env node
/**
 * VedaAI Provider Benchmark
 * Tests each vision provider independently with real images.
 *
 * Usage: node scripts/benchmark.mjs
 * Requires: .env.local with API keys set
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Load .env.local ────────────────────────────────────────────
const envPath = resolve(ROOT, ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").replace(/\r/g, "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) process.env[key] = val;
  }
}

// ── Provider configs (mirrors registry.ts but standalone) ──────
const PROVIDERS = [
  {
    id: "groq",
    displayName: "Groq Qwen 3.6 27B (Primary Fast Path)",
    model: process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b",
    apiKeyEnv: "GROQ_API_KEY",
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    type: "openai",
    timeoutMs: 30000,
  },
  {
    id: "monyet",
    displayName: "Gemini 3.5 Flash (Fast Backup)",
    model: process.env.MONYET_MODEL ?? "myt/gemini-3.5-flash-free",
    apiKeyEnv: "MONYET_API_KEY",
    apiKey: process.env.MONYET_API_KEY,
    baseUrl: process.env.MONYET_BASE_URL ?? "https://tokenin.my.id/v1",
    type: "openai",
    timeoutMs: 45000,
  },
  {
    id: "gemini36",
    displayName: "Gemini 3.6 Flash",
    model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    apiKey: process.env.GEMINI_API_KEY,
    type: "gemini",
    timeoutMs: 45000,
  },
  {
    id: "gemini35",
    displayName: "Gemini 3.5 Flash",
    model: process.env.GEMINI35_MODEL ?? "gemini-3.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    apiKey: process.env.GEMINI_API_KEY,
    type: "gemini",
    timeoutMs: 45000,
  },
  {
    id: "glm46",
    displayName: "GLM-4.6V-Flash",
    model: process.env.GLM_MODEL ?? "glm-4.6v-flash",
    apiKeyEnv: "GLM_API_KEY",
    apiKey: process.env.GLM_API_KEY,
    baseUrl: process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4",
    type: "openai",
    timeoutMs: 45000,
  },
  {
    id: "nemotron",
    displayName: "NVIDIA Nemotron 3 Nano (Reasoning VLM)",
    model: process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    apiKeyEnv: "NVIDIA_API_KEY",
    apiKey: process.env.NVIDIA_API_KEY,
    baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    type: "openai",
    timeoutMs: 45000,
  },
  {
    id: "nemotronOcr",
    displayName: "NVIDIA Nemotron OCR v2 (Specialized OCR Engine)",
    model: "nemotron-ocr-v2",
    apiKeyEnv: "NVIDIA_OCR_API_KEY",
    apiKey: process.env.NVIDIA_OCR_API_KEY || process.env.NVIDIA_API_KEY,
    baseUrl: process.env.NVIDIA_OCR_BASE_URL ?? "https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2",
    type: "nvidia-ocr",
    timeoutMs: 45000,
  },
];

const ATTEMPTS = 3;
const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Preserve the exact visible label in originalLabel and number. Split every labelled sub-part into a separate record: 11(a), 11(b), 11(i), 11(ii), 11(1), 11(2), 11(a)(i), and 11(a)(ii) are all different questions. Never merge subquestions or drop a suffix. Return normalizedNumber as the canonical equivalent: 11(a)->11a, 11(1)->11.1, 11(ii)->11ii, 11(a)(i)->11a.i. Do not convert 11.1 to 111 or 11.10 to 11a. If a label is genuinely unclear, preserve it and use a lower confidence rather than inventing a suffix. Return only JSON with this shape: {"questions":[{"id":"q1","number":"11(a)","originalLabel":"11(a)","normalizedNumber":"11a","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}. Coordinates are normalized 0..1 relative to the page. bbox=[x1,y1,x2,y2], with x1=left, y1=top, x2=right, y2=bottom. The bbox must surround the question number and text. Use null/omit bbox only when it cannot be located.`;

function answerPrompt(questions) {
  return `You are extracting a student's handwritten answer sheet. Detect every answer including its exact original label and bounding box on the page. Preserve answer labels out of order. Treat 41(a), 41(b), 41(i), 41(ii), 41(1), 41(2), 41(a)(i), and 41(a)(ii) as different identities. Never map an answer to a different explicit subpart.

CRITICAL BBOX RULES:
- bbox = [x1, y1, x2, y2] where x1=left edge, y1=top edge, x2=right edge, y2=bottom edge
- All values are normalized 0..1 relative to the page dimensions
- x1 MUST be less than x2 (typically x1=0.05-0.15, x2=0.85-0.95 for full-width text)
- y1 MUST be less than y2 (y2-y1 should be the height of the answer region, typically 0.05-0.25)
- The bbox must TIGHTLY surround ONLY the answer text for that question number
- Do NOT return thin vertical strips. Do NOT return bboxes where x2-x1 < 0.1
- For a handwritten answer on lined paper, the bbox should span from the left margin to the right margin of the text area

Return only JSON with this shape: {"answers":[{"id":"a1","questionNumber":"11(b)","originalLabel":"11(b)","normalizedQuestionNumber":"11b","text":"...","regions":[{"page":1,"bbox":[0.08,0.35,0.92,0.42],"confidence":0.91}],"confidence":0.9}]}.

Available questions: ${JSON.stringify(questions.map(({ number, normalizedNumber, text }) => ({ number, normalizedNumber, text })))}.`;
}

// ── Helpers ────────────────────────────────────────────────────
function stripThinkTags(text) {
  let cleaned = text;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, "");
  return cleaned.trim();
}

function parseModelJson(value) {
  let cleaned = stripThinkTags(value);
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {
    for (let start = cleaned.indexOf("{"); start >= 0; start = cleaned.indexOf("{", start + 1)) {
      let depth = 0, quoted = false, escaped = false;
      for (let index = start; index < cleaned.length; index++) {
        const character = cleaned[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{") depth++;
        else if (character === "}" && --depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, index + 1));
            if (Array.isArray(parsed.questions) || Array.isArray(parsed.answers)) return parsed;
          } catch {
            // Ignore JSON-like fragments and continue to the next candidate.
          }
          break;
        }
      }
    }
    throw new Error("Model returned invalid JSON");
  }
}

function clampBbox(bbox) {
  let [x1, y1, x2, y2] = bbox.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
  if (x2 <= x1) x2 = Math.min(1, x1 + 0.1);
  if (y2 <= y1) y2 = Math.min(1, y1 + 0.1);
  return [x1, y1, x2, y2];
}

function validateQuestions(questions) {
  const issues = [];
  if (!Array.isArray(questions) || questions.length === 0) {
    issues.push("No questions returned");
    return { valid: false, issues, count: 0 };
  }
  const seen = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.number && !q.originalLabel) issues.push(`Q${i + 1}: missing number/label`);
    if (q.bbox) {
      const [x1, y1, x2, y2] = q.bbox;
      if (x1 >= x2 || y1 >= y2) issues.push(`Q${i + 1} (${q.number}): invalid bbox`);
      if (x2 - x1 < 0.02) issues.push(`Q${i + 1} (${q.number}): bbox too narrow`);
    }
    const key = q.normalizedNumber || q.number || q.originalLabel;
    if (seen.has(key)) issues.push(`Q${i + 1} (${q.number}): duplicate`);
    seen.add(key);
  }
  return { valid: issues.length === 0, issues, count: questions.length };
}

function validateAnswers(answers) {
  const issues = [];
  if (!Array.isArray(answers) || answers.length === 0) {
    issues.push("No answers returned");
    return { valid: false, issues, count: 0 };
  }
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!a.regions || !a.regions.length) issues.push(`A${i + 1}: no regions`);
    else {
      for (const r of a.regions) {
        if (r.bbox) {
          const [x1, y1, x2, y2] = r.bbox;
          if (x1 >= x2 || y1 >= y2) issues.push(`A${i + 1} (${a.questionNumber}): invalid bbox`);
        }
      }
    }
  }
  return { valid: issues.length === 0, issues, count: answers.length };
}

// ── Gemini provider (inline) ───────────────────────────────────
async function callGemini(apiKey, model, prompt, file) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelInstance = genAI.getGenerativeModel({ model, generationConfig: { responseMimeType: "application/json" } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const result = await modelInstance.generateContent(
      [prompt, { inlineData: { data: file.data, mimeType: file.mimeType } }],
      { signal: controller.signal }
    );
    const text = result.response.text();
    return parseModelJson(text);
  } finally {
    clearTimeout(timeout);
  }
}

// ── OpenAI-compatible provider (inline) ────────────────────────
async function callOpenAI(config, prompt, file, page = 1) {
  const content = [{ type: "text", text: `${prompt}\nThis is original PDF page ${page}. Preserve this page number in every region.` }];
  content.push({ type: "image_url", image_url: { url: `data:${file.mimeType};base64,${file.data}` } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const t0 = Date.now();
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { error: `HTTP ${response.status}`, elapsed, body: body.slice(0, 200) };
    }
    const body = await response.json();
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text) return { error: "Empty response", elapsed };
    const parsed = parseModelJson(text);
    return { data: parsed, elapsed, rawPreview: text.slice(0, 300) };
  } catch (err) {
    return { error: err.message, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Run benchmark for one provider ─────────────────────────────
async function benchmarkProvider(provider, paperFile, answerFile) {
  const apiKey = provider.apiKey;
  if (!apiKey) return { provider: provider.id, skipped: true, reason: `No ${provider.apiKeyEnv} set` };

  const results = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const run = { attempt, questions: null, answers: null, timings: {}, errors: [] };
    console.log(`  [${provider.id}] attempt ${attempt}/${ATTEMPTS}...`);

    // Step 1: Extract questions
    try {
      const t0 = Date.now();
      let data;
      if (provider.type === "gemini") {
        data = await callGemini(apiKey, provider.model, QUESTION_PROMPT, paperFile);
      } else {
        const res = await callOpenAI(provider, QUESTION_PROMPT, paperFile);
        if (res.error) throw new Error(res.error);
        data = res.data;
        run.timings.questionApi = res.elapsed;
      }
      run.timings.questions = Date.now() - t0;
      const raw = Array.isArray(data?.questions) ? data.questions : [];
      const validated = validateQuestions(raw);
      run.questions = { raw, ...validated };
      if (!validated.valid) run.errors.push(`Question validation: ${validated.issues.join("; ")}`);
    } catch (err) {
      run.timings.questions = 0;
      run.errors.push(`Question extraction: ${err.message}`);
    }

    // Step 2: Extract answers (only if questions succeeded)
    if (run.questions && run.questions.count > 0) {
      try {
        const t0 = Date.now();
        let data;
        const qForPrompt = run.questions.raw.map((q) => ({ number: q.number, normalizedNumber: q.normalizedNumber, text: q.text || "" }));
        const aPrompt = answerPrompt(qForPrompt);
        if (provider.type === "gemini") {
          data = await callGemini(apiKey, provider.model, aPrompt, answerFile);
        } else {
          const res = await callOpenAI(provider, aPrompt, answerFile);
          if (res.error) throw new Error(res.error);
          data = res.data;
          run.timings.answerApi = res.elapsed;
        }
        run.timings.answers = Date.now() - t0;
        const raw = Array.isArray(data?.answers) ? data.answers : [];
        const validated = validateAnswers(raw);
        run.answers = { raw, ...validated };
        if (!validated.valid) run.errors.push(`Answer validation: ${validated.issues.join("; ")}`);
      } catch (err) {
        run.timings.answers = 0;
        run.errors.push(`Answer extraction: ${err.message}`);
      }
    }

    run.timings.total = (run.timings.questions || 0) + (run.timings.answers || 0);
    run.success = run.errors.length === 0 && (run.questions?.count ?? 0) > 0 && (run.answers?.count ?? 0) > 0;
    results.push(run);
    console.log(`    ${run.success ? "PASS" : "FAIL"} | ${run.timings.total}ms | Q:${run.questions?.count ?? 0} A:${run.answers?.count ?? 0} | ${run.errors.join("; ") || "ok"}`);
  }

  return summarizeResults(provider.id, results);
}

// ── Summarize ──────────────────────────────────────────────────
function summarizeResults(id, runs) {
  const successful = runs.filter((r) => r.success);
  const times = successful.map((r) => r.timings.total).sort((a, b) => a - b);
  const qCounts = successful.map((r) => r.questions?.count ?? 0);
  const aCounts = successful.map((r) => r.answers?.count ?? 0);

  // Extract accuracy: check for subpart handling
  let subpartIssues = 0;
  let bboxIssues = 0;
  for (const run of successful) {
    if (!run.questions?.raw) continue;
    for (const q of run.questions.raw) {
      if (q.bbox) {
        const [x1, y1, x2, y2] = q.bbox;
        if (x2 - x1 < 0.02 || y2 - y1 < 0.01) bboxIssues++;
      }
    }
    if (!run.answers?.raw) continue;
    for (const a of run.answers.raw) {
      if (a.regions) {
        for (const r of a.regions) {
          if (r.bbox) {
            const [x1, y1, x2, y2] = r.bbox;
            if (x2 - x1 < 0.02 || y2 - y1 < 0.01) bboxIssues++;
          }
        }
      }
    }
  }

  return {
    id,
    attempts: runs.length,
    successRate: `${successful.length}/${runs.length}`,
    fastestMs: times[0] ?? null,
    medianMs: times[Math.floor(times.length / 2)] ?? null,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    questionsRange: qCounts.length ? `${Math.min(...qCounts)}-${Math.max(...qCounts)}` : "N/A",
    answersRange: aCounts.length ? `${Math.min(...aCounts)}-${Math.max(...aCounts)}` : "N/A",
    bboxIssues,
    subpartIssues,
    allErrors: runs.filter((r) => !r.success).map((r) => r.errors.join("; ")),
    runs,
  };
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("  VedaAI Provider Benchmark");
  console.log("=".repeat(60));
  console.log(`  Input: image11.png (question paper) + image12.png (answer sheet)`);
  console.log(`  Attempts per provider: ${ATTEMPTS}`);
  console.log(`  Providers: ${PROVIDERS.map((p) => p.id).join(", ")}`);
  console.log("=".repeat(60));

  // Load images
  const paperPath = resolve("C:/Users/Bonth/Downloads/image11.png");
  const answerPath = resolve("C:/Users/Bonth/Downloads/image12.png");

  if (!existsSync(paperPath) || !existsSync(answerPath)) {
    console.error("Test images not found:", paperPath, answerPath);
    process.exit(1);
  }

  const paperData = readFileSync(paperPath).toString("base64");
  const answerData = readFileSync(answerPath).toString("base64");
  const paperFile = { data: paperData, mimeType: "image/png", name: "image11.png" };
  const answerFile = { data: answerData, mimeType: "image/png", name: "image12.png" };

  console.log(`\n  Paper: ${(paperData.length * 0.75 / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Answers: ${(answerData.length * 0.75 / 1024 / 1024).toFixed(1)}MB\n`);

  const allResults = [];
  for (const provider of PROVIDERS) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  Provider: ${provider.displayName} (${provider.id})`);
    console.log(`  Model: ${provider.model}`);
    console.log(`  Timeout: ${provider.timeoutMs}ms`);
    console.log(`${"─".repeat(60)}`);
    const result = await benchmarkProvider(provider, paperFile, answerFile);
    allResults.push(result);
  }

  // ── Final table ────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log("  FINAL RESULTS");
  console.log(`${"=".repeat(60)}\n`);

  const header = [
    "Provider".padEnd(18),
    "Avg(ms)".padStart(8),
    "Med(ms)".padStart(8),
    "Fast(ms)".padStart(8),
    "Rate".padStart(6),
    "Qs".padStart(6),
    "As".padStart(6),
    "BBox".padStart(5),
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of allResults) {
    const row = [
      r.id.padEnd(18),
      String(r.avgMs ?? "N/A").padStart(8),
      String(r.medianMs ?? "N/A").padStart(8),
      String(r.fastestMs ?? "N/A").padStart(8),
      r.successRate.padStart(6),
      (r.questionsRange ?? "N/A").padStart(6),
      (r.answersRange ?? "N/A").padStart(6),
      String(r.bboxIssues).padStart(5),
    ].join(" | ");
    console.log(row);
  }

  // ── Ranking ────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log("  RANKING (Speed 40% + Accuracy 30% + Mapping 20% + Reliability 10%)");
  console.log(`${"=".repeat(60)}\n`);

  const scored = allResults
    .filter((r) => !r.skipped && r.avgMs !== null)
    .map((r) => {
      const speedScore = r.avgMs ? Math.max(0, 100 - r.avgMs / 300) : 0;
      const successPct = parseInt(r.successRate.split("/")[0]) / parseInt(r.successRate.split("/")[1]) * 100;
      const reliabilityScore = successPct;
      const accuracyScore = r.bboxIssues === 0 && (r.questionsRange !== "N/A") ? 90 : 50;
      const mappingScore = r.questionsRange !== "N/A" && r.answersRange !== "N/A" ? 80 : 30;
      const overall = speedScore * 0.4 + accuracyScore * 0.3 + mappingScore * 0.2 + reliabilityScore * 0.1;
      return { ...r, overall: Math.round(overall), speedScore: Math.round(speedScore), accuracyScore, mappingScore, reliabilityScore: Math.round(reliabilityScore) };
    })
    .sort((a, b) => b.overall - a.overall);

  for (let i = 0; i < scored.length; i++) {
    const r = scored[i];
    const medal = ["🥇", "🥈", "🥉", "4.", "5."][i];
    console.log(`  ${medal} ${r.id.padEnd(18)} | Overall: ${r.overall}/100 | Speed: ${r.speedScore} | Acc: ${r.accuracyScore} | Map: ${r.mappingScore} | Rel: ${r.reliabilityScore}`);
  }

  // ── Recommended order ──────────────────────────────────────
  const recommended = scored.map((r) => r.id);
  console.log(`\n  RECOMMENDED PROVIDER_ORDER:`);
  console.log(`  ${JSON.stringify(recommended)}`);

  // ── Save report ────────────────────────────────────────────
  const report = { timestamp: new Date().toISOString(), results: allResults, scored, recommendedOrder: recommended };
  writeFileSync(resolve(ROOT, "scripts", "benchmark-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n  Report saved to scripts/benchmark-report.json`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
