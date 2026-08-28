import { z } from "zod";

export const bboxSchema = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
]).refine(([x1, y1, x2, y2]) => x1 < x2 && y1 < y2, "Invalid bounding box");

const confidenceSchema = z.number().finite().min(0).max(1).default(0.5);

export type NormalizationSource = "explicit" | "format_normalization" | "subpart_inference" | "ambiguous";
export type QuestionIdentity = {
  base: string;
  subparts: string[];
  canonical: string;
  confidence: number;
  source: NormalizationSource;
};

const SUBPART_TOKEN = /[a-z]+|\d+/gi;

export function normalizeQuestionIdentity(value: string | null | undefined): QuestionIdentity {
  const original = (value ?? "").trim();
  let text = original.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/^(?:question|ques|q|answer|ans)\s*[.:#-]?\s*/i, "");
  text = text.replace(/\b(?:question|ques|q|answer|ans)\s*[.:#-]?\s*/gi, "");
  text = text.replace(/[\[\]{}]/g, (character) => character === "[" ? "(" : ")");

  const baseMatch = text.match(/\d+/);
  if (!baseMatch) return { base: "", subparts: [], canonical: "", confidence: 0, source: "ambiguous" };
  const base = baseMatch[0];
  const beforeBase = text.slice(0, baseMatch.index ?? 0);
  let remainder = text.slice((baseMatch.index ?? 0) + base.length);
  const bracketed: string[] = [];
  remainder = remainder.replace(/\(\s*([a-z]+|\d+)\s*\)/gi, (_, token: string) => {
    bracketed.push(token.toLowerCase());
    return " ";
  });
  const tokens = [...bracketed, ...(remainder.match(SUBPART_TOKEN) ?? []).map((token) => token.toLowerCase())];
  const subparts = tokens;
  const canonical = base + subparts.map((part, index) => `${index || /^\d+$/.test(part) ? "." : ""}${part}`).join("");
  const hasFormatting = /[()[\]{}\s.:-]/.test(original) || /^(?:question|ques|q|answer|ans)/i.test(original);
  const source: NormalizationSource = subparts.length || hasFormatting ? "format_normalization" : "explicit";
  return { base, subparts, canonical, confidence: canonical ? 0.99 : 0, source };
}

export function normalizeQuestionNumber(value: string | null | undefined) {
  return normalizeQuestionIdentity(value).canonical;
}

export function questionNumberBase(value: string | null | undefined) {
  return normalizeQuestionIdentity(value).base;
}

export const questionSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  normalizedNumber: z.string().optional(),
  originalLabel: z.string().optional(),
  section: z.string().optional(),
  parentNumber: z.string().optional(),
  subquestion: z.string().optional(),
  identity: z.object({
    base: z.string(),
    subparts: z.array(z.string()),
    canonical: z.string(),
    confidence: confidenceSchema,
    source: z.enum(["explicit", "format_normalization", "subpart_inference", "ambiguous"]),
  }).optional(),
  text: z.string().default(""),
  page: z.number().int().positive().default(1),
  bbox: bboxSchema.optional(),
  marks: z.number().nonnegative().nullish(),
  confidence: confidenceSchema,
});

export const answerRegionSchema = z.object({
  page: z.number().int().positive().default(1),
  bbox: bboxSchema,
  confidence: confidenceSchema,
});
export const answerSchema = z.object({
  id: z.string().min(1),
  questionNumber: z.string().nullable().default(null),
  normalizedQuestionNumber: z.string().nullable().optional(),
  originalLabel: z.string().nullable().optional(),
  parentNumber: z.string().optional(),
  subquestion: z.string().optional(),
  identity: z.object({
    base: z.string(),
    subparts: z.array(z.string()),
    canonical: z.string(),
    confidence: confidenceSchema,
    source: z.enum(["explicit", "format_normalization", "subpart_inference", "ambiguous"]),
  }).optional(),
  text: z.string().default(""),
  regions: z.array(answerRegionSchema).min(1),
  confidence: confidenceSchema,
});

export const extractionSchema = z.object({
  questions: z.array(questionSchema),
  answers: z.array(answerSchema),
});
export type Question = z.infer<typeof questionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Region = z.infer<typeof answerRegionSchema>;
export type MappingStatus = "answered" | "unanswered" | "unmatched" | "uncertain";
export type MappedQuestion = Question & {
  answer: Answer | null;
  answers: Answer[];
  status: MappingStatus;
  mappingConfidence: number;
  earnedMarks?: number | null;
  aiFeedback?: string | null;
};

export type UploadedDocument = {
  file: File;
  previewUrls: string[];
  pageCount?: number;
};
