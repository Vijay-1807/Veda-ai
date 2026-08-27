import type { VisionProvider } from "./provider";
import { GeminiProvider } from "./gemini";
import { GLMProvider } from "./glm";
import { OpenAICompatibleVisionProvider } from "./openai-compatible";
import { NemotronOcrClient } from "./nemotron-ocr";
import type { DocumentOcrEngine } from "./document-ocr";

export type ProviderCapability = {
  image: boolean;
  pdf: boolean;
  pdfStrategy: "native" | "render-pages";
};

export type ProviderEntry = {
  id: string;
  displayName: string;
  model: string;
  apiKeyEnv: string;
  baseUrl?: string;
  capabilities: ProviderCapability;
  timeoutMs: number;
  retries: number;
  baseUrlEnv?: string;
  modelEnv?: string;
  requireBaseUrlEnv?: boolean;
};

// ── VLM REASONING PROVIDER CHAIN ────────────────────────────────
// Controlled ordering of multi-modal vision reasoning providers.
// Primary fast path is Groq Qwen 3.6 27B.
export const PROVIDER_ORDER: string[] = [
  "groq",
  "nararouter-stepfun",
  "nararouter-minimax",
  "monyet",
  "glm46",
  "gemini36",
  "nemotron",
  "navyai-gemini25",
  "conduit",
];

export const QUESTION_PROVIDER_ORDER: string[] = [
  "groq",
  "navyai-gemini25",
  "nararouter-stepfun",
  "nararouter-minimax",
  "glm46",
  "gemini36",
  "monyet",
  "nemotron",
  "conduit",
];

export const ANSWER_PROVIDER_ORDER: string[] = [
  "navyai-gemini25",
  "nararouter-minimax",
  "groq",
  "glm46",
  "gemini36",
  "monyet",
  "nararouter-stepfun",
  "nemotron",
  "conduit",
];

// ── SPECIALIZED OCR ENGINE (Separate from VLM Chain) ────────────
export const OCR_ENGINE = "nemotronOcr";
export const OCR_ORDER = ["nemotronOcr"] as const;

// ── PROVIDER DEFINITIONS ───────────────────────────────────────
// Do NOT reorder this — order is controlled by PROVIDER_ORDER above.

const PROVIDER_REGISTRY: ProviderEntry[] = [
  {
    id: "nararouter-stepfun",
    displayName: "NaraRouter StepFun 3.7 Flash",
    model: "stepfun-3.7-flash",
    apiKeyEnv: "NARAROUTER_API_KEY",
    baseUrlEnv: "NARAROUTER_BASE_URL",
    requireBaseUrlEnv: true,
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 8000,
    retries: 0,
  },
  {
    id: "nararouter-minimax",
    displayName: "NaraRouter MiniMax M3 Free",
    model: "minimax-m3-free",
    apiKeyEnv: "NARAROUTER_API_KEY",
    baseUrlEnv: "NARAROUTER_BASE_URL",
    requireBaseUrlEnv: true,
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 8000,
    retries: 0,
  },
  {
    id: "navyai-gemini25",
    displayName: "NavyAI Gemini 2.5 Flash",
    model: "gemini-2.5-flash",
    apiKeyEnv: "NAVYAI_API_KEY",
    baseUrlEnv: "NAVYAI_BASE_URL",
    modelEnv: "NAVYAI_MODEL",
    requireBaseUrlEnv: true,
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 10000,
    retries: 0,
  },
  {
    id: "conduit",
    displayName: "Conduit (Gemini 2.5 Flash / Grok)",
    model: "gemini-2.5-flash",
    apiKeyEnv: "CONDUIT_API_KEY",
    baseUrl: "https://conduit.ozdoev.net/v1",
    modelEnv: "CONDUIT_MODEL",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 10000,
    retries: 0,
  },
  {
    id: "monyet",
    displayName: "Gemini 3.5 Flash (Fast)",
    model: "myt/gemini-3.5-flash-free",
    apiKeyEnv: "MONYET_API_KEY",
    baseUrl: "https://tokenin.my.id/v1",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    modelEnv: "MONYET_MODEL",
    timeoutMs: 7000,
    retries: 0,
  },
  {
    id: "gemini36",
    displayName: "Gemini 3.6 Flash",
    model: "gemini-3.6-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    capabilities: { image: true, pdf: true, pdfStrategy: "native" },
    modelEnv: "GEMINI_MODEL",
    timeoutMs: 8000,
    retries: 0,
  },
  {
    id: "gemini35",
    displayName: "Gemini 3.5 Flash",
    model: "gemini-3.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    capabilities: { image: true, pdf: true, pdfStrategy: "native" },
    modelEnv: "GEMINI35_MODEL",
    timeoutMs: 8000,
    retries: 0,
  },
  {
    id: "glm46",
    displayName: "GLM-4.6V-Flash",
    model: "glm-4.6v-flash",
    apiKeyEnv: "GLM_API_KEY",
    baseUrl: "https://api.z.ai/api/paas/v4",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    modelEnv: "GLM_MODEL",
    timeoutMs: 8000,
    retries: 0,
  },
  {
    id: "groq",
    displayName: "Groq Qwen 3.6 27B",
    model: "qwen/qwen3.6-27b",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    modelEnv: "GROQ_MODEL",
    timeoutMs: 10000,
    retries: 0,
  },
  {
    id: "nemotron",
    displayName: "NVIDIA Nemotron 3 Nano",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    apiKeyEnv: "NVIDIA_API_KEY",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    modelEnv: "NVIDIA_MODEL",
    timeoutMs: 8000,
    retries: 0,
  },
];

// ── LOOKUP ─────────────────────────────────────────────────────

export function getProviderEntry(id: string): ProviderEntry | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

export function getAllProviderEntries(): ProviderEntry[] {
  return [...PROVIDER_REGISTRY];
}

export function getOrderedEntries(): ProviderEntry[] {
  return PROVIDER_ORDER.map(getProviderEntry).filter((e): e is ProviderEntry => e !== undefined);
}

export function getEntriesInOrder(order: string[]): ProviderEntry[] {
  return order.map(getProviderEntry).filter((entry): entry is ProviderEntry => entry !== undefined);
}

// ── CREATE PROVIDERS (runtime, used by the app) ────────────────

export function createProviderFromEntry(entry: ProviderEntry): VisionProvider | null {
  const apiKey = process.env[entry.apiKeyEnv];
  if (!apiKey) return null;
  const configuredBaseUrl = entry.baseUrlEnv
    ? process.env[entry.baseUrlEnv]
    : process.env[`${entry.apiKeyEnv.replace("_API_KEY", "_BASE_URL")}`];
  if (entry.requireBaseUrlEnv && !configuredBaseUrl) return null;

  if (entry.id === "gemini36" || entry.id === "gemini35") {
    const model = (entry.modelEnv ? process.env[entry.modelEnv] : undefined) ?? entry.model;
    return new GeminiProvider(apiKey, model, entry.id, entry.timeoutMs);
  }

  if (entry.id === "glm46") {
    return new GLMProvider(apiKey, entry.timeoutMs);
  }

  const baseUrl = configuredBaseUrl ?? entry.baseUrl;
  return new OpenAICompatibleVisionProvider({
    name: entry.id,
    apiKey,
    baseUrl: baseUrl!,
    model: (entry.modelEnv ? process.env[entry.modelEnv] : undefined) ?? entry.model,
    timeoutMs: entry.timeoutMs,
  });
}

export function createOrderedProviders(): VisionProvider[] {
  return getOrderedEntries()
    .map(createProviderFromEntry)
    .filter((p): p is VisionProvider => p !== null);
}

export function createProvidersInOrder(order: string[]): VisionProvider[] {
  return getEntriesInOrder(order)
    .map(createProviderFromEntry)
    .filter((provider): provider is VisionProvider => provider !== null);
}

/**
 * Returns a configured Nemotron OCR client instance if credentials are present.
 */
export function getOcrEngine(): NemotronOcrClient | null {
  const apiKey = process.env.NVIDIA_OCR_API_KEY || process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return new NemotronOcrClient({
    apiKey,
    baseUrl: process.env.NVIDIA_OCR_BASE_URL || "https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2",
    timeoutMs: 12000,
  });
}

export function getOcrEngines(): DocumentOcrEngine[] {
  const nemotron = getOcrEngine();
  return nemotron ? [nemotron] : [];
}
