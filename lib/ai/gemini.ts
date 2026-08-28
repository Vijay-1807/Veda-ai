import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Answer, Question } from "../types";
import { answerPrompt, answerPromptWithOcr, normalizeExtraction, parseModelJson, QUESTION_PROMPT, questionPromptWithOcr, type VisionFile, type VisionProvider } from "./provider";

export class GeminiProvider implements VisionProvider {
  readonly name: string;
  private model;
  private timeoutMs: number;
  constructor(apiKey: string, model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash", name = "gemini36", timeoutMs = 45000) {
    this.name = name;
    this.timeoutMs = timeoutMs;
    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, generationConfig: { responseMimeType: "application/json" } });
  }
  private async generate(prompt: string, file: VisionFile) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const t0 = Date.now();
    try {
      console.log(`[gemini:${this.name}] generate start model=${this.model.model}`);
      const result = await this.model.generateContent(
        [prompt, { inlineData: { data: file.data, mimeType: file.mimeType } }],
        { signal: controller.signal }
      );
      const text = result.response.text();
      console.log(`[gemini:${this.name}] response ${text.length} chars in ${Date.now() - t0}ms`);
      console.log(`[gemini:${this.name}] raw (first 500): ${text.slice(0, 500)}`);
      return normalizeExtraction(parseModelJson(text));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[gemini:${this.name}] ERROR after ${Date.now() - t0}ms: ${msg}`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  async extractQuestions(file: VisionFile) { return (await this.generate(QUESTION_PROMPT, file)).questions; }
  async extractAnswers(file: VisionFile, questions: Question[]): Promise<Answer[]> { return (await this.generate(answerPrompt(questions), file)).answers; }
  async extractQuestionsWithOcr(file: VisionFile, ocrSummary: string): Promise<Question[]> { return (await this.generate(questionPromptWithOcr(ocrSummary), file)).questions; }
  async extractAnswersWithOcr(file: VisionFile, questions: Question[], ocrSummary: string): Promise<Answer[]> { return (await this.generate(answerPromptWithOcr(questions, ocrSummary), file)).answers; }
  async validateMapping(questions: Question[], answers: Answer[]) { return { questions, answers }; }
}
