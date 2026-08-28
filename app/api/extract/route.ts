import { NextResponse } from "next/server";
import { getProviderChain } from "@/lib/ai";
import { getOcrEngines } from "@/lib/ai/registry";
import type { DocumentOcrEngine } from "@/lib/ai/document-ocr";
import type { OcrDocumentResult } from "@/lib/ai/nemotron-ocr";
import { extractionSchema, type Answer, type Question } from "@/lib/types";
import {
  evaluateQuality,
  validateQuestionQuality,
  validateAnswerQuality,
  extractQuestionsFromOcr,
  extractAnswersFromOcr,
  localizeAnswersWithOcr,
  repairAnswerRegionsWithOcr,
  localizeQuestionsWithOcr,
  ocrSummary,
  countCrossAnswerViolations,
} from "@/lib/ai/ocr-quality";
import { mapAnswers } from "@/lib/mapping";

export const runtime = "nodejs";
export const maxDuration = 120;

type ProviderHealth = {
  provider: string;
  model?: string;
  status: "healthy" | "failed" | "skipped";
  failureReason?: string;
  latencyMs: number;
};

const providerHealthCache = new Map<string, { until: number; reason: string }>();

function cachedProviderFailure(provider: string) {
  const cached = providerHealthCache.get(provider);
  if (!cached) return null;
  if (cached.until <= Date.now()) {
    providerHealthCache.delete(provider);
    return null;
  }
  return cached.reason;
}

function cacheProviderFailure(provider: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const permanent = /http 40[0134]|http 413|http 429|invalid.*(?:key|model)|model.*not found|unsupported.*(?:image|feature)|quota|\brpm\b|\btpm\b|\btpd\b/.test(message);
  const timeout = /timeout|aborted/.test(message);
  const ttlMs = permanent ? 5 * 60_000 : timeout ? 30_000 : 15_000;
  providerHealthCache.set(provider, { until: Date.now() + ttlMs, reason: message.slice(0, 180) });
}

function bboxStats(questions: Question[], answers: Answer[]) {
  const boxes = [
    ...questions.map((question) => question.bbox).filter(Boolean),
    ...answers.flatMap((answer) => answer.regions.map((region) => region.bbox)),
  ];
  const valid = boxes.filter((bbox) => bbox && bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0] < bbox[2] && bbox[1] < bbox[3]).length;
  return { valid, invalid: boxes.length - valid };
}

function crossAnswerViolations(answers: Answer[]) {
  return countCrossAnswerViolations(answers);
}

function problematicAnswerLabels(answers: Answer[]) {
  const labels = new Set<string>();
  const regions = answers.flatMap((answer) => answer.regions.map((region) => ({
    label: answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber || answer.id,
    ...region,
  })));
  for (const region of regions) {
    const width = region.bbox[2] - region.bbox[0];
    const height = region.bbox[3] - region.bbox[1];
    if (width < 0.04 || height < 0.005 || width * height > 0.72) labels.add(region.label);
  }
  for (let left = 0; left < regions.length; left++) {
    for (let right = left + 1; right < regions.length; right++) {
      const a = regions[left];
      const b = regions[right];
      if (a.page !== b.page || a.label === b.label) continue;
      const width = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]));
      const height = Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
      const smaller = Math.min(
        (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]),
        (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
      );
      if (smaller > 0 && width * height / smaller > 0.35) {
        labels.add(a.label);
        labels.add(b.label);
      }
    }
  }
  return labels;
}

function answerDiagnostics(
  questions: Question[],
  answers: Answer[],
  answerOcr: OcrDocumentResult | null
) {
  const ocrAnswers = answerOcr ? extractAnswersFromOcr(answerOcr, questions) : [];
  const detectedAnswerLabels = [...new Set([
    ...answers.map((answer) => answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber || ""),
    ...ocrAnswers.map((answer) => answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber || ""),
  ].filter(Boolean))];
  const questionLabels = new Set(questions.map((question) => question.identity?.canonical || question.normalizedNumber || question.number));
  const answerLabels = new Set(detectedAnswerLabels);
  const missingAnswers = [...questionLabels].filter((label) => !answerLabels.has(label));
  const counts = new Map<string, number>();
  for (const answer of answers) {
    const label = answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber || "";
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const duplicateAnswers = [...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label);
  const requiredLabels = ["41a", "41b", "33", "35", "52b", "37"];
  const requiredMappings = Object.fromEntries(requiredLabels.map((label) => {
    const question = questions.find((item) => (item.identity?.canonical || item.normalizedNumber || item.number) === label);
    const answer = answers.find((item) => (item.identity?.canonical || item.normalizedQuestionNumber || item.questionNumber) === label);
    const mapped = question && answer;
    return [label, {
      questionIdentity: question?.identity?.canonical || question?.normalizedNumber || null,
      answerIdentity: answer?.identity?.canonical || answer?.normalizedQuestionNumber || null,
      page: answer?.regions[0]?.page ?? null,
      regions: answer?.regions ?? [],
      bbox: answer?.regions.map((region) => region.bbox) ?? [],
      status: mapped ? "answered" : question ? "unanswered" : "not-present",
    }];
  }));
  return { detectedAnswerLabels, missingAnswers, duplicateAnswers, requiredMappings };
}

async function extractOcrWithFallback(file: Parameters<DocumentOcrEngine["extractOcr"]>[0], engines: DocumentOcrEngine[]) {
  let lastError: unknown;
  for (const engine of engines) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`[extract:ocr] → ${engine.name} attempt ${attempt + 1}`);
        const result = await engine.extractOcr(file);
        console.log(`[extract:ocr] ← ${engine.name} (${result.totalBlocks} blocks)`);
        return { result, engine: engine.name };
      } catch (error) {
        lastError = error;
        const transient = isTransientFailure(error);
        console.warn(`[extract:ocr] ${engine.name} unavailable:`, error instanceof Error ? error.message : error);
        if (attempt === 0 && transient) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No OCR engine is available");
}

async function toVisionFile(file: File) {
  return {
    data: Buffer.from(await file.arrayBuffer()).toString("base64"),
    mimeType: file.type,
    name: file.name,
  };
}

async function isStructurallyBlankPdf(file: File): Promise<boolean> {
  if (file.type !== "application/pdf") return false;
  const source = Buffer.from(await file.arrayBuffer()).toString("latin1");
  return !/\/Contents\b|\/Subtype\s*\/Image\b|\bBT\b[\s\S]*?\bET\b/.test(source);
}

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

/**
 * PERMANENT / IMMEDIATE-SKIP errors — skip immediately, never retry.
 *   HTTP 400: bad request / invalid schema
 *   HTTP 401/403: auth failure
 *   Daily / free-tier quota exhaustion
 *   TPM rate limits on secondary requests
 *   Timeouts
 */
function isPermanentFailure(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/http 40[0134]|http 403|http 413|http 429|invalid request|invalid_request_error|invalid.*(?:key|model)|unsupported.*(?:input|image|feature)|model.*(?:not found|decommissioned)|json_validate_failed|field.*required/i.test(msg)) return true;
  if (/daily|free.?tier|free_tier|quota.*day|requestsperday|perday|20 requests|freequota|freetier|perproject/i.test(msg)) return true;
  if (/1302|1305|rate limit reached for requests|429 too many requests|requests per minute|\brpm\b|tokens per minute|\btpm\b|tokens per day|\btpd\b|temporarily overloaded|known overload/i.test(msg)) return true;
  if (/timeout|aborted due to timeout/i.test(msg)) return true;
  return false;
}

/**
 * TRANSIENT failures — retry at most once with short delay.
 *   HTTP 5xx (500, 502, 503, 504)
 *   Temporary network connection drops
 */
function isTransientFailure(error: unknown): boolean {
  if (isPermanentFailure(error)) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /http 5\d\d|service.?unavailable|gateway timeout|bad gateway|econnreset|econnrefused/i.test(msg) && !/image_processing_failed|temporarily overloaded/i.test(msg);
}

export async function POST(request: Request) {
  const t0 = Date.now();
  console.log("[extract] Request started");
  const form = await request.formData();
  const paper = form.get("paper");
  const answers = form.get("answers");
  const forceOcr = form.get("forceOcr") === "true";

  if (!(paper instanceof File) || !(answers instanceof File)) {
    return NextResponse.json({ error: "Both documents are required." }, { status: 400 });
  }
  if (!allowedTypes.has(paper.type) || !allowedTypes.has(answers.type)) {
    return NextResponse.json({ error: "Upload a PDF, JPG, JPEG, or PNG file." }, { status: 415 });
  }
  if (!paper.size || !answers.size) {
    return NextResponse.json({ error: "Uploaded files cannot be empty." }, { status: 400 });
  }
  if (paper.size > 10 * 1024 * 1024 || answers.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Each document must be 10MB or smaller." }, { status: 413 });
  }
  if (await isStructurallyBlankPdf(paper) || await isStructurallyBlankPdf(answers)) {
    return NextResponse.json({ error: "Uploaded PDF contains no visible document content." }, { status: 502 });
  }

  console.log(
    `[extract] Files: paper=${paper.name} (${(paper.size / 1024 / 1024).toFixed(1)}MB), ` +
    `answers=${answers.name} (${(answers.size / 1024 / 1024).toFixed(1)}MB)`
  );

  const questionProviders = getProviderChain("questions");
  const answerProviders = getProviderChain("answers");
  const providersByName = new Map(
    [...questionProviders, ...answerProviders].map((provider) => [provider.name, provider])
  );
  const providers = [...providersByName.values()];
  const ocrEngines = getOcrEngines();
  console.log(
    `[extract] Question chain: ${questionProviders.map((p) => p.name).join(" → ")}; ` +
    `answer chain: ${answerProviders.map((p) => p.name).join(" → ")} ` +
    `(OCR engine: ${ocrEngines.map((engine) => engine.name).join(" → ") || "none"})`
  );

  if (!providers.length) {
    return NextResponse.json(
      { error: "AI processing is not configured on this deployment." },
      { status: 503 }
    );
  }

  const paperFile = await toVisionFile(paper);
  const answerFile = await toVisionFile(answers);
  console.log(`[extract] Base64 ready in ${Date.now() - t0}ms`);

  const providerErrors: Array<{
    provider: string;
    stage: "questions" | "answers";
    attempt: number;
    error: string;
    durationMs: number;
  }> = [];
  const providerHealthSummary: ProviderHealth[] = [];
  let totalApiCalls = 0;
  let questionLatencyMs = 0;
  let answerLatencyMs = 0;

  // Request-scoped provider health state
  const unavailableQuestionProviders = new Set<string>();
  const unavailableAnswerProviders = new Set<string>();
  const unavailableForRequest = new Set<string>();
  const questionQualityFailures = new Set<string>();
  const answerQualityFailures = new Set<string>();

  // ══════════════════════════════════════════════════════════════════
  // PHASE 1: QUESTION EXTRACTION
  // ══════════════════════════════════════════════════════════════════
  let extractedQuestions: Question[] = [];
  let questionProvider = "";
  let ocrAssisted = false;
  let ocrLatencyMs = 0;
  let usedOcrEngine = "";
  let cachedPaperOcr: OcrDocumentResult | null = null;
  let cachedAnswerOcr: OcrDocumentResult | null = null;
  let answerRecoveryAttempted = false;
  let initialAnswerCount = 0;
  let bboxRepairCount = 0;
  const semanticRecoveryCount = 0;
  let ocrRecoveryLatencyMs = 0;
  let repairedAnswerLabels: string[] = [];

  for (const provider of questionProviders) {
    const cachedFailure = cachedProviderFailure(provider.name);
    if (cachedFailure) {
      unavailableForRequest.add(provider.name);
      providerHealthSummary.push({ provider: provider.name, status: "skipped", failureReason: `cached: ${cachedFailure}`, latencyMs: 0 });
      continue;
    }
    if (unavailableQuestionProviders.has(provider.name) || unavailableForRequest.has(provider.name)) continue;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (unavailableQuestionProviders.has(provider.name) || unavailableForRequest.has(provider.name)) break;
      const pt0 = Date.now();
      try {
        console.log(`[extract:questions] → ${provider.name} attempt ${attempt + 1}`);
        totalApiCalls++;
        const qs = await provider.extractQuestions(paperFile);
        const durationMs = Date.now() - pt0;

        // Document-level quality check: reject incomplete/truncated results
        const qVal = validateQuestionQuality(qs);
        if (!qVal.ok) {
          const geometryOnly = qs.length >= 3 && /bbox|bounding box/i.test(qVal.reason ?? "");
          if (geometryOnly) {
            console.warn(`[extract:questions] ${provider.name} semantic result preserved for OCR geometry repair: ${qVal.reason}`);
            questionLatencyMs += durationMs;
            extractedQuestions = qs;
            questionProvider = provider.name;
            break;
          }
          console.warn(`[extract:questions] ✗ ${provider.name} rejected: ${qVal.reason} (${durationMs}ms)`);
          questionQualityFailures.add(provider.name);
          throw new Error(`Incomplete question extraction: ${qVal.reason}`);
        }
        questionLatencyMs += durationMs;

        console.log(`[extract:questions] ← ${provider.name} OK (${qs.length}q, ${durationMs}ms)`);
        extractedQuestions = qs;
        questionProvider = provider.name;
        providerHealthSummary.push({ provider: provider.name, status: "healthy", latencyMs: durationMs });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - pt0;
        questionLatencyMs += durationMs;
        const permanent = isPermanentFailure(error);
        const transient = isTransientFailure(error);

        console.log(
          `[extract:questions] ✗ ${provider.name} attempt ${attempt + 1} [${permanent ? "PERM" : transient ? "TRANSIENT" : "UNKNOWN"}]: ${msg.slice(0, 200)} (${durationMs}ms)`
        );

        providerErrors.push({
          provider: provider.name,
          stage: "questions",
          attempt: attempt + 1,
          error: msg.slice(0, 400),
          durationMs,
        });
        providerHealthSummary.push({ provider: provider.name, status: "failed", failureReason: msg.slice(0, 180), latencyMs: durationMs });
        cacheProviderFailure(provider.name, error);

        if (permanent) {
          unavailableQuestionProviders.add(provider.name);
          unavailableForRequest.add(provider.name);
          break;
        }
        if (attempt === 0 && transient) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        unavailableQuestionProviders.add(provider.name);
        unavailableForRequest.add(provider.name);
        break;
      }
    }

    if (extractedQuestions.length >= 3) break;
  }

  if (extractedQuestions.length >= 3 && !validateQuestionQuality(extractedQuestions).ok && ocrEngines.length) {
    const ocrT0 = Date.now();
    try {
      totalApiCalls++;
      const { result: paperOcr, engine } = await extractOcrWithFallback(paperFile, ocrEngines);
      cachedPaperOcr = paperOcr;
      usedOcrEngine = engine;
      ocrLatencyMs += Date.now() - ocrT0;
      extractedQuestions = localizeQuestionsWithOcr(extractedQuestions, paperOcr);
      ocrAssisted = true;
    } catch (ocrErr) {
      console.warn(`[extract:questions] OCR geometry repair failed:`, ocrErr);
    }
  }

  // If VLM providers failed or returned incomplete questions, use Nemotron OCR v2 layout recovery
  if (extractedQuestions.length < 3 && ocrEngines.length) {
    console.log(`[extract:questions] VLMs failed or produced incomplete questions. Triggering Nemotron OCR v2...`);
    const ocrT0 = Date.now();
    try {
      totalApiCalls++;
      const { result: paperOcr, engine } = await extractOcrWithFallback(paperFile, ocrEngines);
      cachedPaperOcr = paperOcr;
      usedOcrEngine = engine;
      ocrLatencyMs += Date.now() - ocrT0;
      const evidence = extractQuestionsFromOcr(paperOcr);
      const recoveryProvider = questionProviders.find((provider) =>
        provider.extractQuestionsWithOcr &&
        (questionQualityFailures.has(provider.name) || !unavailableQuestionProviders.has(provider.name))
      );
      if (evidence.length >= 3 && recoveryProvider?.extractQuestionsWithOcr) {
        totalApiCalls++;
        const reconstructed = await recoveryProvider.extractQuestionsWithOcr(paperFile, ocrSummary(paperOcr));
        const qVal = validateQuestionQuality(reconstructed);
        if (qVal.ok) {
          console.log(`[extract:questions] ← ${recoveryProvider.name}+OCR recovered ${reconstructed.length} questions in ${Date.now() - ocrT0}ms`);
          extractedQuestions = reconstructed;
          questionProvider = `${recoveryProvider.name}+ocr-reasoning`;
          ocrAssisted = true;
        }
      }
    } catch (ocrErr) {
      console.warn(`[extract:questions] Nemotron OCR question recovery failed:`, ocrErr);
    }
  }

  if (extractedQuestions.length === 0) {
    console.log(`[extract] Question extraction failed across all providers (${Date.now() - t0}ms)`);
    return NextResponse.json(
      {
        error: `Question extraction failed across all providers: ${providerErrors.map((e) => `[${e.provider}/Q/${e.attempt}] ${e.error}`).join(" | ")}`,
        details: providerErrors,
        providerHealthSummary,
        totalApiCalls,
        questionLatencyMs,
        answerLatencyMs,
        ocrLatencyMs,
        totalLatencyMs: Date.now() - t0,
      },
      { status: 502 }
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 2: ANSWER EXTRACTION
  // ══════════════════════════════════════════════════════════════════
  let extractedAnswers: Answer[] = [];
  let answerProvider = "";

  // Preserve the configured order. A provider that succeeded for questions may
  // still answer successfully; if its answer request hits TPD/TPM it is skipped
  // immediately by the permanent-failure classifier.
  for (const provider of answerProviders) {
    if (unavailableForRequest.has(provider.name)) continue;
    const cachedFailure = cachedProviderFailure(provider.name);
    if (cachedFailure) {
      unavailableForRequest.add(provider.name);
      providerHealthSummary.push({ provider: provider.name, status: "skipped", failureReason: `cached: ${cachedFailure}`, latencyMs: 0 });
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (unavailableAnswerProviders.has(provider.name) || unavailableForRequest.has(provider.name)) break;
      const pt0 = Date.now();
      try {
        console.log(`[extract:answers] → ${provider.name} attempt ${attempt + 1}`);
        totalApiCalls++;
        const ans = await provider.extractAnswers(answerFile, extractedQuestions);
        const durationMs = Date.now() - pt0;

        // Document-level quality check: reject incomplete/truncated results
        const aVal = validateAnswerQuality(ans, extractedQuestions);
        if (!aVal.ok) {
          console.warn(`[extract:answers] ✗ ${provider.name} rejected: ${aVal.reason} (${durationMs}ms)`);
          answerQualityFailures.add(provider.name);
          throw new Error(`Incomplete answer extraction: ${aVal.reason}`);
        }
        answerLatencyMs += durationMs;

        console.log(`[extract:answers] ← ${provider.name} OK (${ans.length}a, ${durationMs}ms)`);
        extractedAnswers = ans;
        initialAnswerCount = ans.length;
        answerProvider = provider.name;
        providerHealthSummary.push({ provider: provider.name, status: "healthy", latencyMs: durationMs });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - pt0;
        answerLatencyMs += durationMs;
        const permanent = isPermanentFailure(error);
        const transient = isTransientFailure(error);

        console.log(
          `[extract:answers] ✗ ${provider.name} attempt ${attempt + 1} [${permanent ? "PERM" : transient ? "TRANSIENT" : "UNKNOWN"}]: ${msg.slice(0, 200)} (${durationMs}ms)`
        );

      providerErrors.push({
          provider: provider.name,
          stage: "answers",
          attempt: attempt + 1,
          error: msg.slice(0, 400),
          durationMs,
        });
        providerHealthSummary.push({ provider: provider.name, status: "failed", failureReason: msg.slice(0, 180), latencyMs: durationMs });
        cacheProviderFailure(provider.name, error);

        if (attempt === 0 && transient) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        unavailableAnswerProviders.add(provider.name);
        unavailableForRequest.add(provider.name);
        break;
      }
    }

    if (extractedAnswers.length >= 2) break;
  }

  // If VLM providers failed or returned incomplete answers, use Nemotron OCR layout recovery
  if (extractedAnswers.length < 2 && ocrEngines.length) {
    answerRecoveryAttempted = true;
    console.log(`[extract:answers] VLMs failed or produced incomplete answers. Triggering Nemotron OCR v2...`);
    const ocrT0 = Date.now();
    try {
      totalApiCalls++;
      const { result: answerOcr, engine } = await extractOcrWithFallback(answerFile, ocrEngines);
      cachedAnswerOcr = answerOcr;
      usedOcrEngine = engine;
      ocrLatencyMs += Date.now() - ocrT0;
      const evidence = extractAnswersFromOcr(answerOcr, extractedQuestions);
      const recoveryProvider = answerProviders.find((provider) =>
        provider.extractAnswersWithOcr &&
        (answerQualityFailures.has(provider.name) || !unavailableAnswerProviders.has(provider.name))
      );
      if (evidence.length > 0 && recoveryProvider?.extractAnswersWithOcr) {
        totalApiCalls++;
        const reconstructed = await recoveryProvider.extractAnswersWithOcr(answerFile, extractedQuestions, ocrSummary(answerOcr));
        const localized = localizeAnswersWithOcr(reconstructed, answerOcr);
        const aVal = validateAnswerQuality(localized, extractedQuestions);
        if (aVal.ok) {
          extractedAnswers = localized;
          answerProvider = `${recoveryProvider.name}+ocr-reasoning`;
          ocrAssisted = true;
          console.log(`[extract:answers] ← ${answerProvider} recovered ${extractedAnswers.length} answers in ${Date.now() - ocrT0}ms`);
        }
      }
    } catch (ocrErr) {
      console.warn(`[extract:answers] Nemotron OCR answer recovery failed:`, ocrErr);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 3: VALIDATION & MAPPING
  // ══════════════════════════════════════════════════════════════════
  const mappingResult = mapAnswers(extractedQuestions, extractedAnswers);
  let result = extractionSchema.parse({
    questions: extractedQuestions,
    answers: extractedAnswers,
  });

  // ══════════════════════════════════════════════════════════════════
  // PHASE 3.5: AI GRADING
  // ══════════════════════════════════════════════════════════════════
  try {
    const { gradeAnswersWithProvider } = await import("@/lib/ai/provider");
    const questionsToGrade = mappingResult.mapped
      .filter((q) => q.status === "answered" && q.answer && q.answer.text.trim().length > 0)
      .map((q) => ({
        number: q.number,
        text: q.text,
        marks: q.marks ?? 5,
        answerText: q.answer?.text ?? "",
      }));

    if (questionsToGrade.length > 0) {
      console.log(`[extract:grading] Grading ${questionsToGrade.length} answers...`);
      const gradingT0 = Date.now();
      const grades = await gradeAnswersWithProvider(
        { name: questionProvider || answerProvider || "unknown" },
        questionsToGrade
      );
      console.log(`[extract:grading] Graded ${grades.length} answers in ${Date.now() - gradingT0}ms`);

      for (const grade of grades) {
        const mapped = mappingResult.mapped.find((q) => q.number === grade.number);
        if (mapped) {
          mapped.earnedMarks = grade.earned;
          mapped.aiFeedback = grade.feedback;
        }
      }
    }
  } catch (gradingError) {
    console.warn(`[extract:grading] Grading failed, proceeding without grades:`, gradingError instanceof Error ? gradingError.message : gradingError);
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 4: QUALITY GATE & CONDITIONAL OCR ENRICHMENT
  // ══════════════════════════════════════════════════════════════════
  const quality = evaluateQuality(result.questions, result.answers);
  const initialCrossAnswerViolations = crossAnswerViolations(result.answers);
  const acceptedMappingCount = mappingResult.mapped.filter((q) => q.status === "answered" || q.status === "uncertain").length;
  const mappingQualityOk = acceptedMappingCount > 0 || result.answers.every((answer) => !answer.identity?.canonical);
  const effectiveQuality = !quality.ok
    ? quality
    : initialCrossAnswerViolations > 0
      ? { ok: false, reason: `${initialCrossAnswerViolations} cross-answer bbox violation(s)` }
      : !mappingQualityOk
        ? { ok: false, reason: "No extracted answers could be mapped" }
        : quality;
  const avgConf =
    result.questions.reduce((s, q) => s + q.confidence, 0) / (result.questions.length || 1);

  const providerLabel = () =>
    questionProvider === answerProvider
      ? questionProvider
      : [questionProvider, answerProvider].filter(Boolean).join("+");

  if (!effectiveQuality.ok && !ocrEngines.length) {
    const boxes = bboxStats(result.questions, result.answers);
    return NextResponse.json({
      error: `Extraction quality gate failed: ${effectiveQuality.reason}`,
      details: providerErrors,
      providerHealthSummary,
      questionProvider,
      answerProvider,
      ocrEngine: null,
      ocrAssisted: false,
      questionsCount: result.questions.length,
      answersCount: result.answers.length,
      mappedCount: acceptedMappingCount,
      unmatchedCount: mappingResult.unmatched.length,
      bboxValidCount: boxes.valid,
      bboxInvalidCount: boxes.invalid,
      crossAnswerViolations: initialCrossAnswerViolations,
      totalApiCalls,
      questionLatencyMs,
      answerLatencyMs,
      ocrLatencyMs,
      totalLatencyMs: Date.now() - t0,
    }, { status: 422 });
  }

  if (!effectiveQuality.ok && answerRecoveryAttempted) {
    const boxes = bboxStats(result.questions, result.answers);
    return NextResponse.json({
      error: `Extraction quality gate failed after recovery: ${effectiveQuality.reason}`,
      details: providerErrors,
      providerHealthSummary,
      questionProvider,
      answerProvider,
      ocrEngine: usedOcrEngine || null,
      ocrAssisted: Boolean(cachedAnswerOcr),
      questionsCount: result.questions.length,
      answersCount: result.answers.length,
      mappedCount: mappingResult.mapped.filter((q) => q.status === "answered").length,
      uncertainCount: mappingResult.mapped.filter((q) => q.status === "uncertain").length,
      unansweredCount: mappingResult.mapped.filter((q) => q.status === "unanswered").length,
      unmatchedCount: mappingResult.unmatched.length,
      bboxValidCount: boxes.valid,
      bboxInvalidCount: boxes.invalid,
      crossAnswerViolations: crossAnswerViolations(result.answers),
      totalApiCalls,
      questionLatencyMs,
      answerLatencyMs,
      ocrLatencyMs,
      totalLatencyMs: Date.now() - t0,
    }, { status: 422 });
  }

  if ((!effectiveQuality.ok || forceOcr) && ocrEngines.length && !answerRecoveryAttempted) {
    console.log(
      `[extract:ocr] Quality gate: "${effectiveQuality.reason ?? "forceOcr"}". ` +
      `Triggering Nemotron OCR v2 recovery...`
    );
    const ocrStart = Date.now();

    try {
      if (!cachedPaperOcr) totalApiCalls++;
      if (!cachedAnswerOcr) totalApiCalls++;
      const [paperOcrOutcome, answerOcrOutcome] = await Promise.allSettled([
        cachedPaperOcr
          ? Promise.resolve({ result: cachedPaperOcr, engine: usedOcrEngine })
          : extractOcrWithFallback(paperFile, ocrEngines),
        cachedAnswerOcr
          ? Promise.resolve({ result: cachedAnswerOcr, engine: usedOcrEngine })
          : extractOcrWithFallback(answerFile, ocrEngines),
      ]);
      const paperOcr = paperOcrOutcome.status === "fulfilled" ? paperOcrOutcome.value.result : null;
      const answerOcr = answerOcrOutcome.status === "fulfilled" ? answerOcrOutcome.value.result : null;
      cachedPaperOcr = paperOcr;
      cachedAnswerOcr = answerOcr;
      usedOcrEngine = answerOcrOutcome.status === "fulfilled"
        ? answerOcrOutcome.value.engine
        : paperOcrOutcome.status === "fulfilled"
          ? paperOcrOutcome.value.engine
          : usedOcrEngine;

      const ocrMs = Date.now() - ocrStart;
      console.log(
        `[extract:ocr] ${usedOcrEngine || "OCR"} completed in ${ocrMs}ms ` +
        `(paper: ${paperOcr?.totalBlocks ?? "ERR"} blocks, answer: ${answerOcr?.totalBlocks ?? "ERR"} blocks)`
      );

       if (answerOcr) {
         const affected = problematicAnswerLabels(result.answers);
         if (affected.size) {
           const recoveryStart = Date.now();
           const repaired = repairAnswerRegionsWithOcr(result.answers, answerOcr, affected);
           repairedAnswerLabels = [...affected].filter((label) => {
             const before = result.answers.find((answer) => (answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber) === label);
             const after = repaired.find((answer) => (answer.identity?.canonical || answer.normalizedQuestionNumber || answer.questionNumber) === label);
             return Boolean(before && after && JSON.stringify(before.regions) !== JSON.stringify(after.regions));
           });
           bboxRepairCount = repairedAnswerLabels.length;
           result.answers = repaired;
           ocrRecoveryLatencyMs += Date.now() - recoveryStart;
         }
       }

       // Never return a VLM result that failed the document gate. OCR without
       // semantic reconstruction is layout evidence, not an answer payload.
       const finalQuality = evaluateQuality(result.questions, result.answers);
       const finalCrossAnswerViolations = crossAnswerViolations(result.answers);
       if (!finalQuality.ok || finalCrossAnswerViolations > 0) {
         const failedMapping = mapAnswers(result.questions, result.answers);
         const boxes = bboxStats(result.questions, result.answers);
         return NextResponse.json({
           error: `Extraction quality gate failed after recovery: ${finalQuality.reason ?? `${finalCrossAnswerViolations} cross-answer bbox violation(s)`}`,
           details: providerErrors,
           providerHealthSummary,
           questionProvider,
           answerProvider,
           ocrEngine: usedOcrEngine || null,
           ocrAssisted,
           questionsCount: result.questions.length,
           answersCount: result.answers.length,
           mappedCount: failedMapping.mapped.filter((q) => q.status === "answered").length,
           uncertainCount: failedMapping.mapped.filter((q) => q.status === "uncertain").length,
           unansweredCount: failedMapping.mapped.filter((q) => q.status === "unanswered").length,
           unmatchedCount: failedMapping.unmatched.length,
           bboxValidCount: boxes.valid,
            bboxInvalidCount: boxes.invalid,
            crossAnswerViolations: crossAnswerViolations(result.answers),
           totalApiCalls,
           initialAnswerCount,
           bboxRepairCount,
           semanticRecoveryCount,
           repairedAnswerLabels,
           ocrRecoveryLatencyMs,
            questionLatencyMs,
            answerLatencyMs,
            ocrLatencyMs,
           totalLatencyMs: Date.now() - t0,
         }, { status: 422 });
       }

      const activeProvider = providerLabel();
      console.log(`[extract] ✓ ${activeProvider}+OCR conf=${avgConf.toFixed(2)} total=${Date.now() - t0}ms`);
       const finalMapping = mapAnswers(result.questions, result.answers);
       const finalBoxes = bboxStats(result.questions, result.answers);
       const finalDiagnostics = answerDiagnostics(result.questions, result.answers, answerOcr);
       return NextResponse.json({
         ...result,
          mapping: {
           mappedCount: finalMapping.mapped.filter((q) => q.status === "answered" || q.status === "uncertain").length,
           unansweredCount: finalMapping.mapped.filter((q) => q.status === "unanswered").length,
           unmatchedCount: finalMapping.unmatched.length,
          },
          bbox: finalBoxes,
          ...finalDiagnostics,
          questionCount: result.questions.length,
          answerCount: result.answers.length,
          mappedCount: finalMapping.mapped.filter((q) => q.status === "answered" || q.status === "uncertain").length,
          uncertainCount: finalMapping.mapped.filter((q) => q.status === "uncertain").length,
          unansweredCount: finalMapping.mapped.filter((q) => q.status === "unanswered").length,
          unmatchedCount: finalMapping.unmatched.length,
          bboxValid: finalBoxes.valid,
          bboxInvalid: finalBoxes.invalid,
          crossAnswerViolations: crossAnswerViolations(result.answers),
          totalApiCalls,
          initialAnswerCount,
          bboxRepairCount,
          semanticRecoveryCount,
          repairedAnswerLabels,
          ocrRecoveryLatencyMs,
          questionLatencyMs,
          answerLatencyMs,
          totalLatencyMs: Date.now() - t0,
          provider: `${activeProvider}+${usedOcrEngine || "ocr"}`,
         questionProvider,
          answerProvider,
          ocrEngine: usedOcrEngine || null,
          ocrProvider: usedOcrEngine || null,
         ocrAssisted: true,
         ocrLatencyMs: ocrLatencyMs + ocrMs,
        ocrConfidence: answerOcr?.overallConfidence ?? paperOcr?.overallConfidence,
      });
     } catch (ocrErr) {
       console.warn(`[extract:ocr] OCR recovery failed:`, ocrErr instanceof Error ? ocrErr.message : ocrErr);
     }

     return NextResponse.json({
       error: `Extraction quality gate failed: ${effectiveQuality.reason ?? "recovery unavailable"}`,
       details: providerErrors,
       providerHealthSummary,
       questionProvider,
       answerProvider,
       ocrEngine: usedOcrEngine || null,
       ocrAssisted,
       questionsCount: result.questions.length,
       answersCount: result.answers.length,
       mappedCount: mappingResult.mapped.filter((q) => q.status === "answered").length,
       uncertainCount: mappingResult.mapped.filter((q) => q.status === "uncertain").length,
       unansweredCount: mappingResult.mapped.filter((q) => q.status === "unanswered").length,
       unmatchedCount: mappingResult.unmatched.length,
       bboxValidCount: bboxStats(result.questions, result.answers).valid,
       bboxInvalidCount: bboxStats(result.questions, result.answers).invalid,
       crossAnswerViolations: crossAnswerViolations(result.answers),
       totalApiCalls,
       initialAnswerCount,
       bboxRepairCount,
       semanticRecoveryCount,
       repairedAnswerLabels,
       ocrRecoveryLatencyMs,
       questionLatencyMs,
       answerLatencyMs,
       ocrLatencyMs,
       totalLatencyMs: Date.now() - t0,
     }, { status: 422 });
   }

  // ══════════════════════════════════════════════════════════════════
  // FAST PATH SUCCESS
  // ══════════════════════════════════════════════════════════════════
  const activeProvider = providerLabel();
  const finalAnswerDiagnostics = answerDiagnostics(result.questions, result.answers, cachedAnswerOcr);
  const finalBoxes = bboxStats(result.questions, result.answers);
  const finalCrossAnswerViolations = crossAnswerViolations(result.answers);
  if (finalBoxes.invalid || finalCrossAnswerViolations) {
    return NextResponse.json({
      error: "Final bbox validation failed",
      questionProvider,
      answerProvider,
      ocrProvider: usedOcrEngine || null,
      questionCount: result.questions.length,
      answerCount: result.answers.length,
      bboxValid: finalBoxes.valid,
      bboxInvalid: finalBoxes.invalid,
      crossAnswerViolations: finalCrossAnswerViolations,
      totalApiCalls,
      questionLatencyMs,
      answerLatencyMs,
      ocrLatencyMs,
      totalLatencyMs: Date.now() - t0,
    }, { status: 422 });
  }
  console.log(`[extract] ✓ ${activeProvider} conf=${avgConf.toFixed(2)} total=${Date.now() - t0}ms`);
  return NextResponse.json({
    ...result,
    mapping: {
      mappedCount: mappingResult.mapped.filter((q) => q.status === "answered" || q.status === "uncertain").length,
      unansweredCount: mappingResult.mapped.filter((q) => q.status === "unanswered").length,
      unmatchedCount: mappingResult.unmatched.length,
    },
    bbox: bboxStats(result.questions, result.answers),
    ...finalAnswerDiagnostics,
    questionCount: result.questions.length,
    answerCount: result.answers.length,
    mappedCount: mappingResult.mapped.filter((q) => q.status === "answered" || q.status === "uncertain").length,
    uncertainCount: mappingResult.mapped.filter((q) => q.status === "uncertain").length,
    unansweredCount: mappingResult.mapped.filter((q) => q.status === "unanswered").length,
    unmatchedCount: mappingResult.unmatched.length,
    bboxValid: finalBoxes.valid,
    bboxInvalid: finalBoxes.invalid,
    crossAnswerViolations: crossAnswerViolations(result.answers),
    totalApiCalls,
    providerHealthSummary,
    initialAnswerCount,
    bboxRepairCount,
    semanticRecoveryCount,
    repairedAnswerLabels,
    ocrRecoveryLatencyMs,
    questionLatencyMs,
    answerLatencyMs,
    ocrLatencyMs,
    totalLatencyMs: Date.now() - t0,
    provider: activeProvider,
    questionProvider,
    answerProvider,
    ocrEngine: usedOcrEngine || null,
    ocrProvider: usedOcrEngine || null,
    ocrAssisted,
  });
}
