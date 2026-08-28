import type { Answer, MappedQuestion, Question, QuestionIdentity } from "./types";
import { normalizeQuestionIdentity } from "./types";

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "what", "which", "explain", "describe"]);
const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((token) => !STOP_WORDS.has(token)) ?? []);
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.max(a.size, b.size);
};

const questionIdentity = (question: Question) => question.identity ?? normalizeQuestionIdentity(question.normalizedNumber ?? question.number);
const answerIdentity = (answer: Answer) => answer.identity ?? normalizeQuestionIdentity(answer.normalizedQuestionNumber ?? answer.questionNumber);
const hasSuffix = (identity: QuestionIdentity) => identity.subparts.length > 0;

function relation(question: QuestionIdentity, answer: QuestionIdentity) {
  if (!question.canonical || !answer.canonical) return "unlabelled" as const;
  if (question.canonical === answer.canonical) return "exact" as const;
  if (question.base !== answer.base) return "conflict" as const;
  if (hasSuffix(question) && hasSuffix(answer)) return "conflict" as const;
  return "parent" as const;
}

function candidateScore(question: Question, answer: Answer) {
  const questionId = questionIdentity(question);
  const answerId = answerIdentity(answer);
  const numberRelation = relation(questionId, answerId);
  if (numberRelation === "conflict") return { score: -1, relation: numberRelation };
  const semantic = overlap(tokens(question.text), tokens(answer.text));
  const pageContext = answer.regions.some((region) => region.page === question.page || Math.abs(region.page - question.page) <= 1) ? 0.04 : 0;
  if (numberRelation === "exact") return { score: Math.min(1, 0.78 + semantic * 0.16 + answer.confidence * 0.02 + pageContext), relation: numberRelation };
  if (numberRelation === "parent") return { score: Math.min(0.69, 0.38 + semantic * 0.22 + answer.confidence * 0.03 + pageContext), relation: numberRelation };
  return { score: semantic >= 0.7 ? semantic * 0.48 + pageContext : 0, relation: numberRelation };
}

export function mapAnswers(questions: Question[], answers: Answer[]) {
  const used = new Set<number>();
  const exactAssignments = new Map<number, number>();

  // Reserve every exact identity match before attempting parent or semantic inference.
  // This prevents a parent question from consuming an explicit child answer.
  questions.forEach((question, questionIndex) => {
    const identity = questionIdentity(question);
    const answerIndex = answers.findIndex((answer, index) =>
      !used.has(index) && relation(identity, answerIdentity(answer)) === "exact"
    );
    if (answerIndex >= 0) {
      exactAssignments.set(questionIndex, answerIndex);
      used.add(answerIndex);
    }
  });

  const mapped: MappedQuestion[] = questions.map((question, questionIndex) => {
    const exactAnswerIndex = exactAssignments.get(questionIndex);
    if (exactAnswerIndex !== undefined) {
      const answer = answers[exactAnswerIndex];
      return {
        ...question,
        answer,
        answers: [answer],
        status: "answered",
        mappingConfidence: candidateScore(question, answer).score,
      } satisfies MappedQuestion;
    }

    const questionId = questionIdentity(question);
    const candidates = answers
      .map((answer, index) => ({ answer, index, ...candidateScore(question, answer) }))
      .filter((candidate) => !used.has(candidate.index))
      .filter((candidate) => {
        if (candidate.relation !== "parent") return true;
        const answerId = answerIdentity(candidate.answer);
        const hasConflictingSubpart = answers.some((answer) => {
          const other = answerIdentity(answer);
          return answer.id !== candidate.answer.id && other.base === questionId.base && hasSuffix(other);
        });
        return !hasConflictingSubpart;
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    const confidence = best?.score ?? 0;
    const exact = best?.relation === "exact";
    const parentInference = best?.relation === "parent";
    const unlabelledInference = best?.relation === "unlabelled";
    const unique = !second || confidence - second.score >= 0.08;
    const accepted = Boolean(best && (exact || (parentInference && unique && confidence >= 0.42) || (unlabelledInference && unique && confidence >= 0.42)));
    const uncertain = accepted && !exact;
    if (accepted && best) used.add(best.index);
    return {
      ...question,
      answer: accepted && best ? best.answer : null,
      answers: accepted && best ? [best.answer] : [],
      status: accepted ? (uncertain ? "uncertain" : "answered") : "unanswered",
      mappingConfidence: confidence,
    } satisfies MappedQuestion;
  });
  return { mapped, unmatched: answers.filter((_, index) => !used.has(index)) };
}
