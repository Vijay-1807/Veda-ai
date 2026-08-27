import type { Question, Answer } from "../types";
import { normalizeQuestionIdentity } from "../types";
import type { OcrDocumentResult, OcrBlock } from "./nemotron-ocr";
import { sanitizeBbox } from "./provider";

export type QualityResult = { ok: boolean; reason?: string };

/**
 * Validates question extraction quality.
 * Rejects incomplete extractions (e.g. only 1 question on a multi-question document).
 */
export function validateQuestionQuality(questions: Question[]): QualityResult {
  if (!questions || questions.length === 0) {
    return { ok: false, reason: "No questions extracted from question paper" };
  }

  // Reject suspiciously low question count on full exam papers
  if (questions.length <= 2) {
    return {
      ok: false,
      reason: `Suspiciously low question count (${questions.length} question(s) extracted) - incomplete extraction`,
    };
  }

  // More than half the questions have empty text
  const emptyQuestions = questions.filter((q) => !q.text || q.text.trim().length < 3);
  if (emptyQuestions.length >= Math.ceil(questions.length / 2)) {
    return { ok: false, reason: "Majority of questions have empty text" };
  }

  // Duplicate canonical identities — collision detected
  const seen = new Set<string>();
  for (const q of questions) {
    const key = q.identity?.canonical || q.normalizedNumber || q.number;
    if (key && seen.has(key)) {
      return { ok: false, reason: `Duplicate question identity: ${key}` };
    }
    if (key) seen.add(key);
  }

  const bboxCoverage = questions.filter((question) => question.bbox).length / questions.length;
  if (questions.length >= 5 && bboxCoverage < 1) {
    return { ok: false, reason: `Poor question bbox coverage (${Math.round(bboxCoverage * 100)}%)` };
  }
  const unusableQuestionBoxes = questions.length >= 5 ? questions.filter((question) => {
    if (!question.bbox) return true;
    const [x1, y1, x2, y2] = question.bbox;
    const width = x2 - x1;
    const height = y2 - y1;
    return width < 0.04 || height < 0.005 || width * height > 0.8;
  }) : [];
  if (unusableQuestionBoxes.length) {
    return { ok: false, reason: `${unusableQuestionBoxes.length} question bbox(es) are missing, tiny, or page-wide` };
  }

  const avgConf =
    questions.reduce((sum, q) => sum + (q.confidence || 0.5), 0) / questions.length;
  if (avgConf < 0.65) {
    return {
      ok: false,
      reason: `Low document-level confidence (${(avgConf * 100).toFixed(0)}%)`,
    };
  }

  return { ok: true };
}

/**
 * Validates answer extraction quality.
 * Rejects incomplete extractions (e.g. only 1 answer when paper has many questions).
 */
export function validateAnswerQuality(answers: Answer[], questions: Question[]): QualityResult {
  if (!answers || answers.length === 0) {
    return { ok: false, reason: "No answers extracted from student sheet" };
  }

  // If the question paper has many questions (>= 3), answer sheet must have multiple answers
  if (questions.length >= 3 && answers.length <= 1) {
    return {
      ok: false,
      reason: `Suspiciously low answer count (${answers.length} answer(s) extracted for ${questions.length} questions) - incomplete extraction`,
    };
  }

  const degenerateAnswers = answers.filter(
    (a) =>
      !a.regions ||
      a.regions.length === 0 ||
      a.regions.every(
        (r) =>
          !r.bbox ||
          r.bbox[2] - r.bbox[0] <= 0 ||
          r.bbox[3] - r.bbox[1] <= 0
      )
  );
  if (degenerateAnswers.length > Math.ceil(answers.length / 2)) {
    return { ok: false, reason: "Majority of answers have fully degenerate bounding boxes" };
  }

  const seen = new Set<string>();
  for (const answer of answers) {
    const identity = answer.identity?.canonical || answer.normalizedQuestionNumber || "";
    if (identity && seen.has(identity)) return { ok: false, reason: `Duplicate answer identity: ${identity}` };
    if (identity) seen.add(identity);
    if (!answer.text.trim()) return { ok: false, reason: `Empty answer record: ${identity || answer.id}` };
  }

  const regions = answers.flatMap((answer) => answer.regions);
  const unusable = regions.filter(({ bbox: [x1, y1, x2, y2] }) => {
    const width = x2 - x1;
    const height = y2 - y1;
    return width < 0.04 || height < 0.005 || width * height > 0.72;
  });
  if (!regions.length || unusable.length) return { ok: false, reason: "Answer bboxes contain tiny or page-wide regions" };

  return { ok: true };
}

export function countCrossAnswerViolations(answers: Answer[]): number {
  const regions = answers.flatMap((answer) => answer.regions.map((region) => ({ answerId: answer.id, ...region })));
  let violations = 0;
  for (let left = 0; left < regions.length; left++) {
    for (let right = left + 1; right < regions.length; right++) {
      const a = regions[left];
      const b = regions[right];
      if (a.page !== b.page || a.answerId === b.answerId) continue;
      const width = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]));
      const height = Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
      const smaller = Math.min(
        (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]),
        (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
      );
      if (smaller > 0 && width * height / smaller > 0.35) violations++;
    }
  }
  return violations;
}

/**
 * Evaluates full document quality across questions and answers.
 */
export function evaluateQuality(questions: Question[], answers: Answer[]): QualityResult {
  const qCheck = validateQuestionQuality(questions);
  if (!qCheck.ok) return qCheck;

  const aCheck = validateAnswerQuality(answers, questions);
  if (!aCheck.ok) return aCheck;

  return { ok: true };
}

/**
 * Extracts structured questions directly from Nemotron OCR layout blocks.
 * Used as reliable fallback when all VLM providers fail or produce incomplete results.
 */
export function extractQuestionsFromOcr(ocrResult: OcrDocumentResult): Question[] {
  if (!ocrResult || ocrResult.pages.length === 0) return [];

  const questions: Question[] = [];
  const seenNumbers = new Set<string>();

  for (const pageResult of ocrResult.pages) {
    const pageNum = pageResult.page;
    const blocks = [...pageResult.blocks].sort((a, b) => a.bbox[1] - b.bbox[1]);

    let currentSectionMarks = 2;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const text = b.text.trim();

      // Track section marks if mentioned
      const secMatch = text.match(/SECTION\s+[A-E].*?(\d+)\s*[xX*]/i);
      if (secMatch) {
        currentSectionMarks = parseInt(secMatch[1], 10) || currentSectionMarks;
      }

      // Skip header instructions before question area
      if (b.bbox[1] < 0.28 && !text.match(/^2[1-9]/)) continue;
      if (text.toLowerCase().includes("general instructions") || text.toLowerCase().includes("compulsory")) continue;
      if (text.toLowerCase().includes("answer any")) continue;

      // Question number pattern: 21., 22., 31., 41. (a), (b), 51. (a), 52. (b)
      const qMatch =
        text.match(/^(\d{1,2}\s*\([a-d]\))\s*[\.\)]?\s*(.*)/i) ||
        text.match(/^(\d{1,2})\s*[\.\)]\s*(.*)/) ||
        text.match(/^\(([a-d])\)\s*(.*)/i);

      if (qMatch) {
        let num = qMatch[1].replace(/\s+/g, "");
        let qBody = (qMatch[2] || "").trim();

        // Avoid subpart confusion: if just (a) or (b), prefix with previous base question number
        if (num.match(/^[a-d]$/i) || num.match(/^\([a-d]\)$/i)) {
          const cleanSub = num.replace(/[\(\)]/g, "").toLowerCase();
          const prevQ = questions[questions.length - 1];
          const prevBase = prevQ ? prevQ.number.replace(/\([a-d]\)/i, "") : "41";
          num = `${prevBase}(${cleanSub})`;
        }

        if (seenNumbers.has(num)) continue;
        seenNumbers.add(num);

        let combinedBbox = [...b.bbox];
        let marks = currentSectionMarks;

        // Check for explicit marks like [2], [3], [4], [5]
        const marksMatch = qBody.match(/\[(\d+)\]|\((\d+)\s*Marks?\)/i);
        if (marksMatch) {
          marks = parseInt(marksMatch[1] || marksMatch[2], 10);
          qBody = qBody.replace(/\[\d+\]|\(\d+\s*Marks?\)/gi, "").trim();
        }

        // Collect following lines that belong to this question
        let nextIdx = i + 1;
        while (nextIdx < blocks.length) {
          const nextB = blocks[nextIdx];
          const nextText = nextB.text.trim();
          if (isExplicitQuestionLabel(nextText, nextB) || nextText.startsWith("SECTION")) {
            break;
          }
          if (nextB.bbox[1] - combinedBbox[3] < 0.04) {
            if (!nextText.startsWith("[") && nextText.length > 2) {
              qBody += (qBody.length ? " " : "") + nextText;
            }
            combinedBbox[2] = Math.max(combinedBbox[2], nextB.bbox[2]);
            combinedBbox[3] = Math.max(combinedBbox[3], nextB.bbox[3]);
          }
          nextIdx++;
        }

        const sanitizedBbox = sanitizeBbox([
          Math.max(0, combinedBbox[0] - 0.005),
          Math.max(0, combinedBbox[1] - 0.005),
          Math.min(1, combinedBbox[2] + 0.005),
          Math.min(1, combinedBbox[3] + 0.005),
        ]);

        const identity = normalizeQuestionIdentity(num);
        questions.push({
          id: `q${questions.length + 1}`,
          number: num,
          originalLabel: `${num}.`,
          normalizedNumber: identity.canonical || num.toLowerCase().replace(/[\(\)]/g, ""),
          identity: identity.canonical ? identity : undefined,
          text: qBody || `Question ${num}`,
          page: pageNum,
          bbox: sanitizedBbox,
          marks,
          confidence: Number((b.confidence || 0.95).toFixed(2)),
        });
      }
    }
  }

  return questions;
}

function isExplicitQuestionLabel(text: string, block: OcrBlock): boolean {
  return block.bbox[0] < 0.3 && /^(?:\d{1,2}\s*(?:\([a-z]\)|\.[0-9]+|[a-z])?|\([a-z]\))(?=\s|[.)\]:-]|$)/i.test(text.trim());
}

/**
 * Extracts structured answers directly from Nemotron OCR layout blocks.
 * Maps student handwritten answers using recognized headers and regions.
 */
export function extractAnswersFromOcr(
  ocrResult: OcrDocumentResult,
  questions: Question[]
): Answer[] {
  if (!ocrResult || ocrResult.pages.length === 0) return [];

  const answers: Answer[] = [];
  const knownQuestionNumbers = new Set(questions.map((q) => normalizeQuestionIdentity(q.number).canonical));

  for (const pageResult of ocrResult.pages) {
    const pageNum = pageResult.page;
    const blocks = [...pageResult.blocks].sort((a, b) => a.bbox[1] - b.bbox[1]);

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const text = b.text.trim();

      // Match answer headers: 25, 31., 21., (25), 41(a), 41(b), 33., 11(b), 35., 52(b)
      const aMatch =
        text.match(/^[\(\[]?(\d{1,2}(?:\s*\([a-d]\)|\.[0-9]+|[a-d])?)[\)\]\.\:\-\s]*(.*)/i);

      if (aMatch) {
        const rawLabel = aMatch[1].replace(/\s+/g, "");
        const trailingText = (aMatch[2] || "").trim();

        // Check if label matches an expected question number or looks like a question number (1-99)
        const parsedNum = parseInt(rawLabel, 10);
        const isLikelyAnswerHeader =
          knownQuestionNumbers.size === 0 ||
          knownQuestionNumbers.has(normalizeQuestionIdentity(rawLabel).canonical) ||
          (parsedNum >= 1 && parsedNum <= 99 && b.bbox[0] < 0.25);

        if (!isLikelyAnswerHeader) continue;

        let combinedBbox = [...b.bbox];
        let ansText = trailingText;

        // Collect answer lines until next answer header
        let nextIdx = i + 1;
        while (nextIdx < blocks.length) {
          const nextB = blocks[nextIdx];
          const nextText = nextB.text.trim();
          const isNextHeader = isExplicitAnswerLabel(nextText, nextB);

          if (isNextHeader) break;

          if (nextText.length > 1) {
            ansText += (ansText.length ? " " : "") + nextText;
          }
          combinedBbox[2] = Math.max(combinedBbox[2], nextB.bbox[2]);
          combinedBbox[3] = Math.max(combinedBbox[3], nextB.bbox[3]);
          nextIdx++;
        }

        const sanitizedBbox = sanitizeBbox([
          Math.max(0, combinedBbox[0] - 0.005),
          Math.max(0, combinedBbox[1] - 0.005),
          Math.min(1, combinedBbox[2] + 0.005),
          Math.min(1, combinedBbox[3] + 0.005),
        ]);
        if (!sanitizedBbox) continue;

        const identity = normalizeQuestionIdentity(rawLabel);
        answers.push({
          id: `a${answers.length + 1}`,
          questionNumber: rawLabel,
          originalLabel: `${rawLabel}.`,
          normalizedQuestionNumber: identity.canonical || rawLabel.toLowerCase().replace(/[\(\)]/g, ""),
          identity: identity.canonical ? identity : undefined,
          text: ansText || `Answer for question ${rawLabel}`,
          regions: [{ page: pageNum, bbox: sanitizedBbox, confidence: Number((b.confidence || 0.92).toFixed(2)) }],
          confidence: Number((b.confidence || 0.92).toFixed(2)),
        });
      }
    }
  }

  return answers;
}

/**
 * Enriches answer regions with OCR bounding boxes where the VLM produced
 * missing, full-page default, or degenerate coordinates.
 */
export function enrichWithOcrBboxes(
  answers: Answer[],
  ocrResult?: OcrDocumentResult | null
): Answer[] {
  if (!ocrResult || ocrResult.totalBlocks === 0) return answers;

  return answers.map((answer) => {
    const enrichedRegions = answer.regions.map((region) => {
      const bbox = region.bbox;
      const isDefaultOrFull =
        !bbox ||
        (bbox[0] === 0 && bbox[1] === 0 && bbox[2] === 1 && bbox[3] === 1);
      const isDegenerate =
        bbox && (bbox[2] - bbox[0] <= 0 || bbox[3] - bbox[1] <= 0 || bbox[2] - bbox[0] < 0.04);

      if (!isDefaultOrFull && !isDegenerate) return region;

      const pageBlocks =
        ocrResult.pages.find((p) => p.page === region.page)?.blocks ?? [];
      const label = (answer.originalLabel || answer.questionNumber || "").toLowerCase();

      const matchingBlock = label.length > 0
        ? pageBlocks.find((b) => b.text.toLowerCase().includes(label))
        : null;

      if (!matchingBlock) return region;

      return {
        ...region,
        bbox: matchingBlock.bbox,
        confidence: Math.max(region.confidence, matchingBlock.confidence),
      };
    });

    return { ...answer, regions: enrichedRegions };
  });
}

function isExplicitAnswerLabel(text: string, block: OcrBlock): boolean {
  return block.bbox[0] < 0.3 && /^[\(\[]?\d{1,2}(?:\s*\([a-z]\)|\.[0-9]+|[a-z])?(?=[\)\]\.\:\-\s]|$)/i.test(text.trim());
}

export function ocrSummary(ocrResult: OcrDocumentResult): string {
  return ocrResult.pages.map((page) =>
    `PAGE ${page.page}\n${page.blocks.map((b) => {
      const bbox = b.bbox.map((value) => Number(value.toFixed(3)));
      return `${bbox.join(",")} ${b.text.slice(0, 240)}`;
    }).join("\n")}`
  ).join("\n\n");
}

export function localizeAnswersWithOcr(answers: Answer[], ocrResult: OcrDocumentResult): Answer[] {
  const segments = extractAnswersFromOcr(ocrResult, []);
  const byIdentity = new Map(segments.map((answer) => [answer.identity?.canonical, answer]));
  return answers.map((answer) => {
    const key = answer.identity?.canonical ?? normalizeQuestionIdentity(answer.questionNumber).canonical;
    const segment = byIdentity.get(key);
    return segment ? { ...answer, regions: segment.regions } : answer;
  });
}

/** Replace geometry only for explicitly affected answers, preserving VLM text. */
export function repairAnswerRegionsWithOcr(
  answers: Answer[],
  ocrResult: OcrDocumentResult,
  labels?: Set<string>
): Answer[] {
  const segments = extractAnswersFromOcr(ocrResult, []);
  const byIdentity = new Map(
    segments.map((answer) => [answer.identity?.canonical || answer.normalizedQuestionNumber, answer])
  );
  return answers.map((answer) => {
    const key = answer.identity?.canonical ?? normalizeQuestionIdentity(answer.questionNumber).canonical;
    if (labels && !labels.has(key)) return answer;
    const segment = byIdentity.get(key);
    return segment ? { ...answer, regions: segment.regions } : answer;
  });
}

export function localizeQuestionsWithOcr(questions: Question[], ocrResult: OcrDocumentResult): Question[] {
  const segments = extractQuestionsFromOcr(ocrResult);
  const byIdentity = new Map(segments.map((question) => [question.identity?.canonical, question]));
  return questions.map((question) => {
    if (question.bbox) return question;
    const key = question.identity?.canonical ?? normalizeQuestionIdentity(question.number).canonical;
    const segment = byIdentity.get(key);
    return segment?.bbox && segment.page === question.page
      ? { ...question, bbox: segment.bbox, confidence: Math.min(question.confidence, segment.confidence) }
      : question;
  });
}
