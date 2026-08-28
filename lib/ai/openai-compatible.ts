import type { Answer, Question } from "../types";
import {
  answerPrompt,
  answerPromptWithOcr,
  normalizeExtraction,
  parseModelJson,
  QUESTION_PROMPT,
  questionPromptWithOcr,
  type VisionFile,
  type VisionProvider,
} from "./provider";
import { renderPdfPages } from "./pdf-pages";

type Config = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  supportsVision?: boolean;
};

const GROQ_PROVIDER_IDS = new Set(["groq"]);

export class OpenAICompatibleVisionProvider implements VisionProvider {
  readonly name: string;
  private config: Config;
  private supportsVision: boolean;

  constructor(config: Config) {
    this.config = config;
    this.name = config.name;
    this.supportsVision = config.supportsVision !== false;
  }

  private async generate(prompt: string, file: VisionFile, page: number) {
    const t0 = Date.now();
    console.log(
      `[openai:${this.name}] generate start model=${this.config.model} vision=${this.supportsVision}`
    );

    // Build the user content array
    const userContent: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [
      {
        type: "text",
        text:
          `${prompt}\nIMPORTANT: Return ONLY valid raw JSON. No Markdown, no code fences, no <think> tags.\n` +
          `This is original PDF page ${page}. Preserve this page number in every region.`,
      },
    ];

    if (this.supportsVision) {
      const mime =
        file.mimeType === "application/pdf" ? "image/jpeg" : file.mimeType;
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${file.data}` },
      });
    }

    const isGroq = GROQ_PROVIDER_IDS.has(this.name);
    const isAnswerRequest = prompt.includes("student's handwritten answer sheet");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model: this.config.model,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.1,
      stream: false,
    };

    if (isGroq) {
      body.max_completion_tokens = isAnswerRequest ? 1800 : 4096;
      body.reasoning_effort = "none";
    } else {
      body.max_tokens = isAnswerRequest ? 1800 : 4096;
    }

    console.log(
      `[openai:${this.name}] payload: ` +
      `messages.isArray=${Array.isArray(body.messages)} ` +
      `messages.length=${body.messages?.length} ` +
      `messages[0].role=${body.messages?.[0]?.role} ` +
      `content.isArray=${Array.isArray(body.messages?.[0]?.content)} ` +
      `content.length=${body.messages?.[0]?.content?.length}`
    );

    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
      }
    );

    console.log(
      `[openai:${this.name}] HTTP ${response.status} in ${Date.now() - t0}ms`
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(
        `${this.name} request failed: HTTP ${response.status} - ${errBody.slice(0, 300)}`
      );
    }

    const respJson = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = respJson.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error(`${this.name} returned empty response`);

    console.log(
      `[openai:${this.name}] raw (first 500): ${text.slice(0, 500)}`
    );

    const extraction = normalizeExtraction(parseModelJson(text));
    return {
      questions: extraction.questions.map((q) => ({ ...q, page })),
      answers: extraction.answers.map((a) => ({
        ...a,
        regions: a.regions.map((r) => ({ ...r, page })),
      })),
    };
  }

  private async generatePages(prompt: string, file: VisionFile) {
    const pages = await renderPdfPages(file);
    const results: Array<Awaited<ReturnType<typeof this.generate>>> = [];
    for (const page of pages) {
      results.push(await this.generate(prompt, page, page.page));
    }
    const questions = results.flatMap((result) => result.questions).map((question, index) => ({
      ...question,
      id: `q${index + 1}`,
    }));
    const answers = results.flatMap((result) => result.answers).reduce<Answer[]>((merged, answer) => {
      const canonical = answer.identity?.canonical ?? answer.normalizedQuestionNumber ?? "";
      const existing = canonical
        ? merged.find((item) => (item.identity?.canonical ?? item.normalizedQuestionNumber ?? "") === canonical)
        : undefined;
      if (!existing) {
        merged.push({ ...answer, id: `a${merged.length + 1}` });
        return merged;
      }
      existing.regions = [...existing.regions, ...answer.regions].filter((region, index, all) =>
        all.findIndex((item) => item.page === region.page && item.bbox.join(",") === region.bbox.join(",")) === index
      );
      existing.text = [existing.text, answer.text]
        .filter(Boolean)
        .filter((text, index, all) => all.indexOf(text) === index)
        .join(" ")
        .slice(0, 500);
      existing.confidence = Math.max(existing.confidence, answer.confidence);
      return merged;
    }, []);
    return { questions, answers };
  }

  async extractQuestions(file: VisionFile): Promise<Question[]> {
    return (await this.generatePages(QUESTION_PROMPT, file)).questions;
  }

  async extractAnswers(
    file: VisionFile,
    questions: Question[]
  ): Promise<Answer[]> {
    return (await this.generatePages(answerPrompt(questions), file)).answers;
  }

  async extractQuestionsWithOcr(file: VisionFile, ocrSummary: string): Promise<Question[]> {
    return (await this.generatePages(questionPromptWithOcr(ocrSummary), file)).questions;
  }

  async extractAnswersWithOcr(file: VisionFile, questions: Question[], ocrSummary: string): Promise<Answer[]> {
    return (await this.generatePages(answerPromptWithOcr(questions, ocrSummary), file)).answers;
  }

  async validateMapping(questions: Question[], answers: Answer[]) {
    return { questions, answers };
  }
}
