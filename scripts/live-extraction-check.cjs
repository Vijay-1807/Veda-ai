const fs = require("node:fs");
const path = require("node:path");

async function run() {
  const root = path.resolve(__dirname, "..");
  const paperPath = path.resolve(root, "..", "image11.png");
  const answerPath = path.resolve(root, "..", "image12.png");
  const form = new FormData();
  form.append("paper", new Blob([fs.readFileSync(paperPath)], { type: "image/png" }), "image11.png");
  form.append("answers", new Blob([fs.readFileSync(answerPath)], { type: "image/png" }), "image12.png");
  const started = Date.now();
  const response = await fetch("http://localhost:3000/api/extract", { method: "POST", body: form });
  const result = await response.json();
  const summary = {
    status: response.status,
    latencyMs: Date.now() - started,
    provider: result.provider,
    questionProvider: result.questionProvider,
    answerProvider: result.answerProvider,
    ocrEngine: result.ocrEngine,
    ocrAssisted: result.ocrAssisted,
    questionCount: result.questionCount ?? result.questionsCount ?? result.questions?.length,
    answerCount: result.answerCount ?? result.answersCount ?? result.answers?.length,
    mappedCount: result.mappedCount,
    unmatchedCount: result.unmatchedCount,
    bboxValid: result.bboxValid ?? result.bboxValidCount,
    bboxInvalid: result.bboxInvalid ?? result.bboxInvalidCount,
    crossAnswerViolations: result.crossAnswerViolations,
    error: result.error,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!response.ok) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
