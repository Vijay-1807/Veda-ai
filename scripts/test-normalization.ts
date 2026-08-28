import assert from "node:assert/strict";
import { mapAnswers } from "../lib/mapping";
import { normalizeQuestionIdentity, normalizeQuestionNumber, type Answer, type Question } from "../lib/types";
import { renderPdfPages } from "../lib/ai/pdf-pages";
import {
  ANSWER_PROVIDER_ORDER,
  getAllProviderEntries,
  PROVIDER_ORDER,
  QUESTION_PROVIDER_ORDER,
} from "../lib/ai/registry";

const expectedProviderOrder = [
  "navyai-gemini25",
  "ollama-gemma4",
  "ollama-minimax-m3",
  "gemini35",
  "groq",
  "nararouter-stepfun",
  "nararouter-minimax",
  "monyet",
  "nemotron",
];
assert.deepEqual(PROVIDER_ORDER, expectedProviderOrder);
assert.deepEqual(QUESTION_PROVIDER_ORDER, expectedProviderOrder);
assert.deepEqual(ANSWER_PROVIDER_ORDER, expectedProviderOrder);
const registeredProviderIds = getAllProviderEntries().map((entry) => entry.id);
assert.ok(!registeredProviderIds.includes("glm46"), "GLM must not be registered");
assert.ok(!registeredProviderIds.includes("conduit"), "Conduit must not be registered");

const equivalentGroups = [
  ["11", "(11)"],
  ["11a", "11A", "11(a)", "11 (a)", "11( a )", "(11)(a)", "(11) (a)", "[11](a)", "11[a]", "11{a}", "11-a", "11-a)", "11(a).", "Q11(a)", "Q.11(a)", "Question 11(a)", "Ans 11(a)", "11 - (a)"],
  ["11b", "11B", "11(b)", "(11)(b)"],
  ["11.1", "11(1)", "11 (1)", "(11)(1)", "(11) (1)", "11-1"],
  ["11.2", "11(2)", "(11)(2)"],
  ["11i", "11(i)", "(11)(i)", "11I"],
  ["11ii", "11(ii)", "(11)(ii)", "11II"],
  ["11a.i", "11(a)(i)", "(11)(a)(i)"],
  ["11a.ii", "11(a)(ii)", "(11)(a)(ii)"],
  ["11a.1", "11(a)(1)"],
  ["11a.2", "11(a)(2)"],
  ["41i", "41.i", "41(i)", "41I"],
  ["41ii", "41.ii", "41(ii)", "41II"],
  ["41.1.1", "41(1)(1)", "41.1.1"],
];

for (const [expected, ...labels] of equivalentGroups) {
  for (const label of labels) assert.equal(normalizeQuestionNumber(label), expected, `${label} should normalize to ${expected}`);
}

const distinctPairs = [
  ["2", "22"], ["2", "12"], ["11", "111"], ["41", "4"],
  ["41a", "41b"], ["41a", "41c"], ["11i", "11ii"], ["11ii", "11iii"],
  ["11.1", "11.2"], ["11(a)(i)", "11(a)(ii)"], ["11(a)(1)", "11(a)(2)"],
];
for (const [left, right] of distinctPairs) assert.notEqual(normalizeQuestionNumber(left), normalizeQuestionNumber(right), `${left} must differ from ${right}`);

const question = (number: string, text = number): Question => ({
  id: `q-${number}`, number, originalLabel: number, normalizedNumber: normalizeQuestionNumber(number),
  identity: normalizeQuestionIdentity(number), text, page: 1, confidence: 0.95,
});
const answer = (id: string, number: string, text = number): Answer => ({
  id, questionNumber: number, originalLabel: number, normalizedQuestionNumber: normalizeQuestionNumber(number),
  identity: normalizeQuestionIdentity(number), text, regions: [{ page: 1, bbox: [0.1, 0.1, 0.9, 0.2], confidence: 0.9 }], confidence: 0.9,
});

const mapped = mapAnswers(
  [question("41(a)"), question("41(b)"), question("22", "chemical formula of baking soda")],
  [answer("a1", "41(b)"), answer("a2", "41(a)"), answer("a3", "2", "baking soda is NaHCO3")],
).mapped;
assert.equal(mapped[0].answer?.id, "a2");
assert.equal(mapped[1].answer?.id, "a1");
assert.equal(mapped[2].answer, null, "explicit answer 2 must not map to question 22");

const inferred = mapAnswers([question("41")], [answer("a1", "41(a)")]).mapped[0];
assert.equal(inferred.answer?.id, "a1");
assert.equal(inferred.status, "uncertain");

const blockedInference = mapAnswers([question("41")], [answer("a1", "41(a)"), answer("a2", "41(b)")]).mapped[0];
assert.equal(blockedInference.answer, null, "plain parent must not infer when conflicting subparts exist");

const exactChildPriority = mapAnswers(
  [question("41"), question("41(a)")],
  [answer("a1", "41(a)")]
).mapped;
assert.equal(exactChildPriority[0].answer, null, "parent must not consume an exact child answer");
assert.equal(exactChildPriority[1].answer?.id, "a1", "exact child match must be reserved first");

const minimalPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF").toString("base64");
const renderedPages = await renderPdfPages({ data: minimalPdf, mimeType: "application/pdf", name: "test.pdf" });
assert.equal(renderedPages.length, 1);
assert.equal(renderedPages[0].page, 1);
assert.equal(renderedPages[0].mimeType, "image/png");
assert.notEqual(renderedPages[0].data, minimalPdf, "fallback providers must receive rendered image data");

console.log("Normalization and mapping tests passed");
