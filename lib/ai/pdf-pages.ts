import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VisionFile } from "./provider";

export type VisionPage = VisionFile & { page: number };

/**
 * Optimizes image resolution and compresses to clean JPEG before vision transmission.
 * Keeps dimensions within maxDim (default 1280px) and filesize under ~250KB,
 * preventing proxy body size limits (e.g. Monyet 400) and reducing Groq TPM usage.
 */
export async function optimizeVisionFile(file: VisionFile, maxDim = 1280): Promise<VisionFile> {
  if (file.mimeType === "application/pdf") return file;

  try {
    const { createCanvas, loadImage } = await import(/* webpackIgnore: true */ "@napi-rs/canvas");
    const buf = Buffer.from(file.data, "base64");
    const img = await loadImage(buf);

    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const jpegBuf = canvas.toBuffer("image/jpeg");
    return {
      data: jpegBuf.toString("base64"),
      mimeType: "image/jpeg",
      name: file.name.replace(/\.[^.]+$/, ".jpg"),
    };
  } catch (err) {
    console.warn("[optimizeVisionFile] Image optimization skipped:", err);
    return file;
  }
}

export async function renderPdfPages(file: VisionFile): Promise<VisionPage[]> {
  if (file.mimeType !== "application/pdf") {
    const opt = await optimizeVisionFile(file);
    return [{ ...opt, page: 1 }];
  }

  const { getDocument, GlobalWorkerOptions } = await import(/* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import(/* webpackIgnore: true */ "@napi-rs/canvas");
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).toString();
  }

  const document = await getDocument({ data: new Uint8Array(Buffer.from(file.data, "base64")) }).promise;
  const pages: VisionPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as never, viewport }).promise;
    const pngBuf = canvas.toBuffer("image/png");
    pages.push({
      data: pngBuf.toString("base64"),
      mimeType: "image/png",
      name: `${file.name}-page-${pageNumber}.png`,
      page: pageNumber,
    });
  }

  return pages;
}
