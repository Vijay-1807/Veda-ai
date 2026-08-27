import type { VisionFile } from "./provider";
import { renderPdfPages } from "./pdf-pages";

export type OcrBlock = {
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
};

export type OcrPageResult = {
  page: number;
  blocks: OcrBlock[];
  fullText: string;
  averageConfidence: number;
};

export type OcrDocumentResult = {
  pages: OcrPageResult[];
  totalBlocks: number;
  overallConfidence: number;
};

export type RawNvidiaOcrResponse = {
  data?: Array<{
    index?: number;
    text_detections?: Array<{
      text_prediction?: {
        text?: string;
        confidence?: number;
      };
      bounding_box?: {
        points?: Array<{ x: number; y: number }>;
      };
    }>;
  }>;
};

/**
 * Normalizes an array of polygon corner points into a clean [x1, y1, x2, y2] bounding box clamped to [0, 1].
 */
export function normalizeOcrPoints(points: Array<{ x: number; y: number }> | undefined | null): [number, number, number, number] | null {
  if (!points || !Array.isArray(points) || points.length === 0) return null;
  
  const xs = points.map((p) => Number(p?.x)).filter((x) => Number.isFinite(x));
  const ys = points.map((p) => Number(p?.y)).filter((y) => Number.isFinite(y));
  if (xs.length === 0 || ys.length === 0) return null;

  let x1 = Math.max(0, Math.min(1, Math.min(...xs)));
  let y1 = Math.max(0, Math.min(1, Math.min(...ys)));
  let x2 = Math.max(0, Math.min(1, Math.max(...xs)));
  let y2 = Math.max(0, Math.min(1, Math.max(...ys)));

  if (x2 <= x1) x2 = Math.min(1, x1 + 0.05);
  if (y2 <= y1) y2 = Math.min(1, y1 + 0.02);

  return [x1, y1, x2, y2];
}

/**
 * Parses the raw NVIDIA Nemotron OCR v2 JSON response into internal OcrPageResult.
 */
export function parseNvidiaOcrResponse(raw: RawNvidiaOcrResponse, pageNumber: number): OcrPageResult {
  const detections = raw?.data?.[0]?.text_detections || [];
  const blocks: OcrBlock[] = [];

  for (const det of detections) {
    const text = (det?.text_prediction?.text || "").trim();
    if (!text) continue;

    const rawConfidence = det?.text_prediction?.confidence;
    const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0.5;

    const bbox = normalizeOcrPoints(det?.bounding_box?.points) || [0.05, 0.05, 0.95, 0.95];
    blocks.push({ text, bbox, confidence });
  }

  // Sort blocks by reading order (top-to-bottom, left-to-right)
  blocks.sort((a, b) => {
    const yDiff = a.bbox[1] - b.bbox[1];
    if (Math.abs(yDiff) > 0.02) return yDiff;
    return a.bbox[0] - b.bbox[0];
  });

  const fullText = blocks.map((b) => b.text).join(" ");
  const averageConfidence = blocks.length
    ? blocks.reduce((sum, b) => sum + b.confidence, 0) / blocks.length
    : 0;

  return {
    page: pageNumber,
    blocks,
    fullText,
    averageConfidence,
  };
}

export class NemotronOcrClient {
  readonly name = "nemotronOcr";
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
    this.apiKey = options?.apiKey || process.env.NVIDIA_OCR_API_KEY || process.env.NVIDIA_API_KEY || "";
    this.baseUrl = options?.baseUrl || process.env.NVIDIA_OCR_BASE_URL || "https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2";
    this.timeoutMs = options?.timeoutMs || 45000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Run OCR on a single image page.
   */
  async processPage(file: VisionFile, pageNumber: number): Promise<OcrPageResult> {
    if (!this.isConfigured()) {
      throw new Error("NVIDIA Nemotron OCR v2 is not configured with an API key");
    }

    const t0 = Date.now();
    const payload = {
      input: [
        {
          url: `data:${file.mimeType};base64,${file.data}`,
        },
      ],
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`NVIDIA OCR request failed HTTP ${response.status}: ${errorBody.slice(0, 250)}`);
    }

    const rawData = (await response.json()) as RawNvidiaOcrResponse;
    const pageResult = parseNvidiaOcrResponse(rawData, pageNumber);
    console.log(`[ocr:nemotron] Page ${pageNumber} OK: ${pageResult.blocks.length} blocks, avg conf ${(pageResult.averageConfidence * 100).toFixed(1)}% in ${Date.now() - t0}ms`);
    return pageResult;
  }

  /**
   * Extract OCR for an entire document (handles PDF page rendering and image inputs).
   * Preserves exact original PDF page numbers.
   */
  async extractOcr(file: VisionFile): Promise<OcrDocumentResult> {
    const pages = await renderPdfPages(file);
    const pageResults: OcrPageResult[] = [];

    for (const page of pages) {
      // Process sequentially to prevent API throttling
      const res = await this.processPage(page, page.page);
      pageResults.push(res);
    }

    const totalBlocks = pageResults.reduce((sum, p) => sum + p.blocks.length, 0);
    const overallConfidence = pageResults.length
      ? pageResults.reduce((sum, p) => sum + p.averageConfidence, 0) / pageResults.length
      : 0;

    return {
      pages: pageResults,
      totalBlocks,
      overallConfidence,
    };
  }
}
