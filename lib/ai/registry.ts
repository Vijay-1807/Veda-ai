import type { VisionProvider } from "./provider";
import { GeminiProvider } from "./gemini";
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
// Verified providers lead each phase; intermittent providers remain as fallbacks.
export const PROVIDER_ORDER: string[] = [
  "ollama-gemma4",
  "ollama-minimax-m3",
  "gemini35",
  "groq",
  "nararouter-stepfun",
  "nararouter-minimax",
  "monyet",
  "nemotron",
  "navyai-gemini25",
];

export const QUESTION_PROVIDER_ORDER: string[] = [
  "ollama-gemma4",
  "ollama-minimax-m3",
  "gemini35",
  "groq",
  "nararouter-stepfun",
  "nararouter-minimax",
  "monyet",
  "nemotron",
  "navyai-gemini25",
];

export const ANSWER_PROVIDER_ORDER: string[] = [
  "ollama-gemma4",
  "ollama-minimax-m3",
  "gemini35",
  "groq",
  "nararouter-stepfun",
  "nararouter-minimax",
  "monyet",
  "nemotron",
  "navyai-gemini25",
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
    timeoutMs: 15000,
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
    timeoutMs: 20000,
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
    timeoutMs: 20000,
    retries: 0,
  },
  {
    id: "ollama-gemma4",
    displayName: "Ollama Cloud Gemma 4 31B",
    model: "gemma4:31b",
    apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
    baseUrl: "https://ollama.com/v1",
    modelEnv: "OLLAMA_GEMMA_MODEL",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 30000,
    retries: 0,
  },
  {
    id: "ollama-minimax-m3",
    displayName: "Ollama Cloud MiniMax M3",
    model: "minimax-m3",
    apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
    baseUrl: "https://ollama.com/v1",
    modelEnv: "OLLAMA_MINIMAX_MODEL",
    capabilities: { image: true, pdf: false, pdfStrategy: "render-pages" },
    timeoutMs: 45000,
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
    timeoutMs: 30000,
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
