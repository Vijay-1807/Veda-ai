import { parseModelJson, sanitizeBbox, type VisionFile } from "./provider";
import { renderPdfPages } from "./pdf-pages";
import type { OcrBlock, OcrDocumentResult, OcrPageResult } from "./nemotron-ocr";

export interface DocumentOcrEngine {
  readonly name: string;
  extractOcr(file: VisionFile): Promise<OcrDocumentResult>;
}

type OcrConfig = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  openAiCompatible: boolean;
  timeoutMs?: number;
};

function normalizeBlock(value: unknown): OcrBlock | null {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = String(item.text ?? item.content ?? item.label ?? "").trim();
  const bbox = sanitizeBbox(item.bbox ?? item.box ?? item.bounding_box ?? item.coordinates);
  if (!text || !bbox) return null;
  const rawConfidence = Number(item.confidence ?? item.score ?? 0.8);
  return { text, bbox, confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.8 };
}

function blocksFromResponse(raw: unknown): OcrBlock[] {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const candidates = [value.blocks, value.regions, value.text_blocks, value.detections, value.text_detections];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(normalizeBlock).filter((b): b is OcrBlock => b !== null);
  }
  const pages = Array.isArray(value.pages) ? value.pages : [];
  return pages.flatMap((page) => blocksFromResponse(page));
}

export class ExternalDocumentOcrClient implements DocumentOcrEngine {
  readonly name: string;

  constructor(private config: OcrConfig) {
    this.name = config.name;
  }

  private async processPage(file: VisionFile, page: number): Promise<OcrPageResult> {
    const url = this.config.openAiCompatible
      ? `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`
      : this.config.baseUrl;
    const imageUrl = `data:${file.mimeType};base64,${file.data}`;
    const body = this.config.openAiCompatible
      ? {
          model: this.config.model,
          messages: [{ role: "user", content: [
            { type: "text", text: "Return JSON only: {\"blocks\":[{\"text\":\"...\",\"bbox\":[x1,y1,x2,y2],\"confidence\":0.9}]}. Preserve reading order and normalized coordinates." },
            { type: "image_url", image_url: { url: imageUrl } },
          ] }],
          temperature: 0,
          max_tokens: 4096,
        }
      : { model: this.config.model, image: imageUrl, page };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 12000),
    });
    if (!response.ok) throw new Error(`${this.name} OCR failed HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
    const responseJson = await response.json() as Record<string, unknown>;
    const raw = this.config.openAiCompatible
      ? parseModelJson(String(((responseJson.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content) ?? ""))
      : responseJson;
    const blocks = blocksFromResponse(raw).sort((a, b) => Math.abs(a.bbox[1] - b.bbox[1]) > 0.015 ? a.bbox[1] - b.bbox[1] : a.bbox[0] - b.bbox[0]);
    if (!blocks.length) throw new Error(`${this.name} OCR returned no valid layout blocks`);
    const averageConfidence = blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length;
    return { page, blocks, fullText: blocks.map((b) => b.text).join(" "), averageConfidence };
  }

  async extractOcr(file: VisionFile): Promise<OcrDocumentResult> {
    const pages = await renderPdfPages(file);
    const results: OcrPageResult[] = [];
    for (const page of pages) results.push(await this.processPage(page, page.page));
    const totalBlocks = results.reduce((sum, page) => sum + page.blocks.length, 0);
    const overallConfidence = results.length ? results.reduce((sum, page) => sum + page.averageConfidence, 0) / results.length : 0;
    return { pages: results, totalBlocks, overallConfidence };
  }
}
