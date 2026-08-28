import {
  answerSchema,
  normalizeQuestionIdentity,
  questionSchema,
  type Answer,
  type Question,
} from "../types";

export type VisionFile = { data: string; mimeType: string; name: string };
export interface VisionProvider {
  readonly name: string;
  extractQuestions(file: VisionFile): Promise<Question[]>;
  extractAnswers(file: VisionFile, questions: Question[]): Promise<Answer[]>;
  validateMapping(
    questions: Question[],
    answers: Answer[]
  ): Promise<{ questions: Question[]; answers: Answer[] }>;
  extractQuestionsWithOcr?(file: VisionFile, ocrSummary: string): Promise<Question[]>;
  extractAnswersWithOcr?(file: VisionFile, questions: Question[], ocrSummary: string): Promise<Answer[]>;
}

export const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Preserve the exact visible label in originalLabel and number. Extract the full printed question body text into the text field. Split every labelled sub-part into a separate record: 11(a), 11(b), 11(i), 11(ii), 11(1), 11(2), 11(a)(i), and 11(a)(ii) are all different questions. Never merge subquestions or drop a suffix. Return normalizedNumber as the canonical equivalent: 11(a)->11a, 11(1)->11.1, 11(ii)->11ii, 11(a)(i)->11a.i. Do not convert 11.1 to 111 or 11.10 to 11a. If a label is genuinely unclear, preserve it and use a lower confidence rather than inventing a suffix. Return only JSON with this shape: {"questions":[{"id":"q1","number":"11(a)","originalLabel":"11(a)","normalizedNumber":"11a","text":"What is photosynthesis? Explain with a diagram.","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}. Coordinates are normalized 0..1 relative to the page. bbox=[x1,y1,x2,y2], with x1=left, y1=top, x2=right, y2=bottom. The bbox must surround the question number and text. Use null/omit bbox only when it cannot be located.`;

export const answerPrompt = (questions: Question[]) => `You are extracting a student's handwritten answer sheet. Detect every answer label and its exact localized bbox. Preserve labels out of order. Treat parent and subparts as different identities. Never map an answer to a different explicit subpart. Process the image only; return concise answer text (maximum 500 characters per answer) and do not repeat the question list in the response.

CRITICAL BBOX RULES:
- bbox = [x1, y1, x2, y2] where x1=left edge, y1=top edge, x2=right edge, y2=bottom edge
- All values are normalized 0..1 relative to the page dimensions
- x1 MUST be less than x2 (typically x1=0.05-0.15, x2=0.85-0.95 for full-width text)
- y1 MUST be less than y2 (y2-y1 should be the height of the answer region, typically 0.05-0.25)
- The bbox must TIGHTLY surround ONLY the answer text for that question number
- A new explicit answer label ALWAYS starts a new region. Never include the next labelled answer in the current bbox
- Labels such as 41, 41(a), and 41(b) are distinct; a parent label must never absorb a sibling subquestion
- Do NOT return thin vertical strips. Do NOT return bboxes where x2-x1 < 0.1
- For a handwritten answer on lined paper, the bbox should span from the left margin to the right margin of the text area

Return only JSON with this shape: {"answers":[{"id":"a1","questionNumber":"11(b)","originalLabel":"11(b)","normalizedQuestionNumber":"11b","text":"...","regions":[{"page":1,"bbox":[0.08,0.35,0.92,0.42],"confidence":0.91}],"confidence":0.9}]}.

Expected labels: ${JSON.stringify(questions.map(({ number, normalizedNumber }) => [number, normalizedNumber]))}.`;

export function questionPromptWithOcr(ocrSummary?: string): string {
  if (!ocrSummary) return QUESTION_PROMPT;
  return `${QUESTION_PROMPT}

SUPPLEMENTAL OCR EVIDENCE (from layout & OCR specialist engine):
Use this OCR evidence to help detect faint text, question numbers, and layout bounding boxes. If visual interpretation differs from OCR text, prefer your direct visual reasoning.
${ocrSummary}`;
}

export function answerPromptWithOcr(questions: Question[], ocrSummary?: string): string {
  const base = answerPrompt(questions);
  if (!ocrSummary) return base;
  return `${base}

SUPPLEMENTAL OCR EVIDENCE (from layout & OCR specialist engine):
Use this OCR evidence to assist with region bounding boxes and line detection. Handwriting interpretation should remain based primarily on your visual understanding.
${ocrSummary.slice(0, 9000)}`;
}

export function parseModelJson(value: string): unknown {
  let cleaned = value.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const openThink = cleaned.search(/<think\b/i);
  if (openThink >= 0) {
    const closeIdx = cleaned.indexOf("</think>", openThink);
    if (closeIdx >= 0) {
      cleaned = cleaned.slice(closeIdx + 8);
    } else {
      const jsonStart = cleaned.indexOf("{", openThink);
      cleaned = jsonStart >= 0 ? cleaned.slice(jsonStart) : cleaned.slice(0, openThink);
    }
  }

  // 1. Extract content inside ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {}
  }

  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // 2. Try direct JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 3. Try finding the outermost { ... }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Try fixing unescaped newlines inside strings
      try {
        const sanitized = candidate.replace(/(?<!\\)\n(?=([^"]*"[^"]*")*[^"]*$)/g, "\\n");
        return JSON.parse(sanitized);
      } catch {}
    }
  }

  // 4. Bracket-counting scan for valid JSON objects
  for (
    let start = cleaned.indexOf("{");
    start >= 0;
    start = cleaned.indexOf("{", start + 1)
  ) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
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
          const parsed = JSON.parse(cleaned.slice(start, index + 1)) as Record<string, unknown>;
          if (Array.isArray(parsed.questions) || Array.isArray(parsed.answers)) return parsed;
        } catch {}
        break;
      }
    }
  }

  throw new Error("Model returned invalid or truncated JSON");
}

/**
 * Robust per-item bbox sanitization:
 * - verifies 4 finite numbers
 * - clamps to [0, 1]
 * - reorders reversed coordinates: x1=min(x1,x2), x2=max(x1,x2), y1=min(y1,y2), y2=max(y1,y2)
 * - adjusts collapsed/zero-area dimensions safely
 * - returns [x1, y1, x2, y2] strictly satisfying x1 < x2 && y1 < y2 in [0, 1]
 * - returns undefined if unusable, allowing callers to omit bbox without failing the entire extraction
 */
export function sanitizeBbox(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined;

  const n0 = typeof raw[0] === "number" ? raw[0] : Number(raw[0]);
  const n1 = typeof raw[1] === "number" ? raw[1] : Number(raw[1]);
  const n2 = typeof raw[2] === "number" ? raw[2] : Number(raw[2]);
  const n3 = typeof raw[3] === "number" ? raw[3] : Number(raw[3]);

  if (!Number.isFinite(n0) || !Number.isFinite(n1) || !Number.isFinite(n2) || !Number.isFinite(n3)) {
    return undefined;
  }

  // Clamp each coordinate to [0, 1]
  const c0 = Math.max(0, Math.min(1, n0));
  const c1 = Math.max(0, Math.min(1, n1));
  const c2 = Math.max(0, Math.min(1, n2));
  const c3 = Math.max(0, Math.min(1, n3));

  // Reorder coordinates: x1=min, x2=max, y1=min, y2=max
  let x1 = Math.min(c0, c2);
  let x2 = Math.max(c0, c2);
  let y1 = Math.min(c1, c3);
  let y2 = Math.max(c1, c3);

  // Repair collapsed coordinates locally; never expand to a page-wide region.
  if (x2 <= x1) {
    x1 = Math.max(0, x1 - 0.005);
    x2 = Math.min(1, x2 + 0.005);
  }
  if (y2 <= y1) {
    y1 = Math.max(0, y1 - 0.003);
    y2 = Math.min(1, y2 + 0.003);
  }
  if (x2 - x1 < 0.01 || y2 - y1 < 0.005) return undefined;

  // Final validation check: strictly 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1
  if (x1 < x2 && y1 < y2 && x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1) {
    return [
      Number(x1.toFixed(4)),
      Number(y1.toFixed(4)),
      Number(x2.toFixed(4)),
      Number(y2.toFixed(4)),
    ];
  }

  return undefined;
}

export function normalizeExtraction(input: unknown) {
  const value = (typeof input === "object" && input !== null ? input : {}) as {
    questions?: unknown;
    answers?: unknown;
  };
  const questionItems = Array.isArray(value.questions) ? value.questions : [];
  const answerItems = Array.isArray(value.answers) ? value.answers : [];

  const rawQuestions = questionItems.map((item: unknown, index: number) => {
    const question = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const originalLabel = String(
      question.originalLabel ?? question.number ?? question.normalizedNumber ?? `${index + 1}`
    ).trim();
    const identity = normalizeQuestionIdentity(originalLabel);
    const sanitizedBbox = question.bbox ? sanitizeBbox(question.bbox) : undefined;

    return {
      id: typeof question.id === "string" && question.id.length > 0 ? question.id : `q${index + 1}`,
      number: typeof question.number === "string" && question.number.length > 0 ? question.number : originalLabel,
      originalLabel,
      normalizedNumber: identity.canonical || (typeof question.normalizedNumber === "string" ? question.normalizedNumber : undefined),
      section: typeof question.section === "string" ? question.section : undefined,
      parentNumber: identity.base || undefined,
      subquestion: identity.subparts.length ? identity.subparts.join(".") : undefined,
      identity: identity.canonical ? identity : undefined,
      text: typeof question.text === "string" ? question.text : "",
      page: typeof question.page === "number" && question.page > 0 ? Math.floor(question.page) : 1,
      bbox: sanitizedBbox,
      marks: typeof question.marks === "number" && question.marks >= 0 ? question.marks : undefined,
      confidence:
        typeof question.confidence === "number" && Number.isFinite(question.confidence)
          ? Math.max(0, Math.min(1, question.confidence))
          : 0.5,
    };
  });

  // Safely parse each question individually so a single malformed item never invalidates the entire document
  const questions: Question[] = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const parseResult = questionSchema.safeParse(rawQuestions[i]);
    if (parseResult.success) {
      questions.push(parseResult.data);
    } else {
      // If bbox caused an issue, fall back without bbox (omitted bbox is valid in questionSchema)
      const withoutBbox = { ...rawQuestions[i], bbox: undefined };
      const fallbackResult = questionSchema.safeParse(withoutBbox);
      if (fallbackResult.success) {
        questions.push(fallbackResult.data);
      } else {
        console.warn(`[normalizeExtraction] Question ${i + 1} skipped due to validation failure:`, parseResult.error.message);
      }
    }
  }

  const rawAnswers = answerItems.map((item: unknown, index: number) => {
    const answer = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const originalLabel =
      typeof answer.originalLabel === "string"
        ? answer.originalLabel
        : typeof answer.questionNumber === "string"
        ? answer.questionNumber
        : typeof answer.normalizedQuestionNumber === "string"
        ? answer.normalizedQuestionNumber
        : null;
    const identity = normalizeQuestionIdentity(originalLabel);
    const rawRegions = Array.isArray(answer.regions) ? answer.regions : [];

    const regions = rawRegions.map((region) => {
      const r = (typeof region === "object" && region !== null ? region : {}) as Record<string, unknown>;
      const sanitizedBbox = sanitizeBbox(r.bbox);
      const page = typeof r.page === "number" && r.page > 0 ? Math.floor(r.page) : 1;
      const confidence =
        typeof r.confidence === "number" && Number.isFinite(r.confidence)
          ? Math.max(0, Math.min(1, r.confidence))
          : typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
          ? Math.max(0, Math.min(1, answer.confidence))
          : 0.5;
      return sanitizedBbox ? { page, bbox: sanitizedBbox, confidence } : null;
    }).filter((region): region is NonNullable<typeof region> => region !== null);

    return {
      id: typeof answer.id === "string" && answer.id.length > 0 ? answer.id : `a${index + 1}`,
      questionNumber: typeof answer.questionNumber === "string" ? answer.questionNumber : (originalLabel ?? null),
      originalLabel: originalLabel ?? undefined,
      normalizedQuestionNumber: identity.canonical || (typeof answer.normalizedQuestionNumber === "string" ? answer.normalizedQuestionNumber : null),
      parentNumber: identity.base || undefined,
      subquestion: identity.subparts.length ? identity.subparts.join(".") : undefined,
      identity: identity.canonical ? identity : undefined,
      text: typeof answer.text === "string" ? answer.text : "",
      regions,
      confidence:
        typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
          ? Math.max(0, Math.min(1, answer.confidence))
          : 0.5,
    };
  });

  const parsedAnswers: Answer[] = [];
  for (let i = 0; i < rawAnswers.length; i++) {
    const parseResult = answerSchema.safeParse(rawAnswers[i]);
    if (parseResult.success) {
      parsedAnswers.push(parseResult.data);
    } else {
      console.warn(`[normalizeExtraction] Answer ${i + 1} skipped due to validation failure:`, parseResult.error.message);
    }
  }

  // Merge multi-region answers for the same question
  const answers = parsedAnswers.reduce<Answer[]>((merged, answer) => {
    const canonical = answer.identity?.canonical ?? answer.normalizedQuestionNumber ?? "";
    const previous = canonical
      ? merged.find((item) => (item.identity?.canonical ?? item.normalizedQuestionNumber ?? "") === canonical)
      : undefined;
    if (!previous) {
      merged.push(answer);
      return merged;
    }
    const regions = [...previous.regions, ...answer.regions].filter(
      (region, index, all) =>
        all.findIndex(
          (item) => item.page === region.page && item.bbox.join(",") === region.bbox.join(",")
        ) === index
    );
    const text = previous.text.length >= answer.text.length ? previous.text : answer.text;
    Object.assign(previous, {
      regions,
      text,
      confidence: Math.max(previous.confidence, answer.confidence),
    });
    return merged;
  }, []);

  return { questions, answers };
}

// ── AI GRADING ────────────────────────────────────────────────────

export const GRADING_PROMPT = (questions: Array<{ number: string; text: string; marks: number | null; answerText: string }>) =>
  `You are an expert exam evaluator. Grade each student answer against its question. Read the student's answer text carefully and evaluate how well it answers the question.

GRADING RULES:
- Award partial marks for partially correct answers
- A completely correct, complete answer gets full marks
- A partially correct answer gets proportional marks (e.g., 1/2, 2/3, 3/5)
- An incorrect or irrelevant answer gets 0 marks
- An empty or missing answer gets 0 marks
- Consider: correctness, completeness, key points covered, accuracy

For each question, return the earned marks from 0 to the maximum.

Return ONLY valid JSON with this shape:
{"grades":[{"number":"1","earned":2,"feedback":"Correct answer with good explanation."},{"number":"2","earned":0,"feedback":"No answer provided."},{"number":"3","earned":1,"feedback":"Partially correct - mentioned photosynthesis but missed the diagram requirement."}]}

Questions to grade:
${JSON.stringify(questions, null, 2)}`;

export interface GradeResult {
  number: string;
  earned: number;
  feedback: string;
}

export async function gradeAnswersWithProvider(
  provider: { name: string },
  questions: Array<{ number: string; text: string; marks: number | null; answerText: string }>
): Promise<GradeResult[]> {
  const prompt = GRADING_PROMPT(questions);

  // Text-only models for grading (no vision needed - answer text already extracted)
  const attempts = [
    {
      name: "groq",
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || "",
      model: "qwen/qwen3.6-27b",
      isGroq: true,
    },
    {
      name: "ollama-gemma4",
      baseUrl: "https://ollama.com/v1",
      apiKey: process.env.OLLAMA_CLOUD_API_KEY || "",
      model: "gemma4:31b",
      isGroq: false,
    },
    {
      name: "ollama-minimax",
      baseUrl: "https://ollama.com/v1",
      apiKey: process.env.OLLAMA_CLOUD_API_KEY || "",
      model: "minimax-m3",
      isGroq: false,
    },
    {
      name: "monyet",
      baseUrl: process.env.MONYET_BASE_URL || "https://tokenin.my.id/v1",
      apiKey: process.env.MONYET_API_KEY || "",
      model: process.env.MONYET_MODEL || "myt/gemini-3.5-flash-free",
      isGroq: false,
    },
    {
      name: "navyai",
      baseUrl: process.env.NAVYAI_BASE_URL || "https://api.navy/v1",
      apiKey: process.env.NAVYAI_API_KEY || "",
      model: "gemini-2.5-flash",
      isGroq: false,
    },
  ];

  for (const attempt of attempts) {
    if (!attempt.apiKey) continue;

    try {
      console.log(`[grading] Trying ${attempt.name}...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {
        model: attempt.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 4096,
      };
      // Groq needs reasoning_effort=none to prevent thinking tags
      if (attempt.isGroq) {
        body.max_completion_tokens = 4096;
        body.reasoning_effort = "none";
        delete body.max_tokens;
      }

      const response = await fetch(`${attempt.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${attempt.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        console.warn(`[grading] ${attempt.name} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      const parsed = parseModelJson(text) as { grades?: GradeResult[] } | null;

      if (parsed && Array.isArray(parsed.grades)) {
        console.log(`[grading] ${attempt.name} graded ${parsed.grades.length} answers`);
        return parsed.grades.map((grade) => ({
          number: String(grade.number),
          earned: Math.max(0, Math.min(grade.earned ?? 0, questions.find((q) => q.number === grade.number)?.marks ?? 0)),
          feedback: String(grade.feedback ?? ""),
        }));
      } else {
        console.warn(`[grading] ${attempt.name} returned invalid JSON, raw (first 300):`, text.slice(0, 300));
      }
    } catch (error) {
      console.warn(`[grading] ${attempt.name} failed:`, error instanceof Error ? error.message : error);
    }
  }

  return [];
}
