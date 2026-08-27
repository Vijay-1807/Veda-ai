import { OpenAICompatibleVisionProvider } from "./openai-compatible";

export class GLMProvider extends OpenAICompatibleVisionProvider {
  constructor(apiKey: string, timeoutMs = 12000) {
    super({ name: "glm46", apiKey, baseUrl: process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4", model: process.env.GLM_MODEL ?? "glm-4.6v-flash", timeoutMs });
  }
}
