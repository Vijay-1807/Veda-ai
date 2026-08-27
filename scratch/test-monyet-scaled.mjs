import { readFileSync, existsSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const envPath = "C:\\Users\\Bonth\\Downloads\\Vedai\\.env.local";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k) process.env[k] = v;
  }
}

const nvKey = process.env.NVIDIA_OCR_API_KEY;

async function getOcr(imagePath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(1200, Math.round(1200 * (img.height / img.width)));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const b64 = canvas.toBuffer("image/jpeg").toString("base64");

  const res = await fetch("https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${nvKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      input: [{ url: `data:image/jpeg;base64,${b64}` }]
    })
  });
  const json = await res.json();
  const detections = json?.data?.[0]?.text_detections ?? [];
  return detections.map(d => {
    const pts = d.bounding_box?.points || [];
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return {
      text: (d.text_prediction?.text || "").trim(),
      conf: d.text_prediction?.confidence || 0,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    };
  }).filter(b => b.text.length > 0).sort((a, b) => a.bbox[1] - b.bbox[1]);
}

const qBlocks = await getOcr("C:\\Users\\Bonth\\Downloads\\image11.png");
console.log("=== EXTRACTING QUESTIONS FROM OCR BLOCKS ===");

function parseQuestionsFromOcr(blocks) {
  const questions = [];
  const qRegex = /^(?:(?:SECTION\s+[A-E]|Case\s+Study)\s*)?(\d{1,2}(?:\s*\([a-d]\)|\.[0-9]+|[a-d])?|\([a-d]\))\b[\.\:\-\s]*(.*)/i;
  
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Skip headers and instructions
    if (b.bbox[1] < 0.30 && !b.text.match(/^2[1-9]/)) continue;
    if (b.text.toLowerCase().includes("general instructions") || b.text.toLowerCase().includes("compulsory")) continue;
    if (b.text.toLowerCase().includes("answer any")) continue;

    // Check if block starts with a question label
    const match = b.text.match(/^(\d{1,2})\s*[\.\)]\s*(.*)/) ||
                  b.text.match(/^(\d{1,2}\s*\([a-d]\))\s*[\.\)]?\s*(.*)/i) ||
                  b.text.match(/^\(([a-d])\)\s*(.*)/i);

    if (match) {
      let num = match[1].replace(/\s+/g, "");
      let text = (match[2] || "").trim();

      // Check if next block is subpart or continuation
      let nextIdx = i + 1;
      let combinedBbox = [...b.bbox];
      let marks = 2;

      // Extract marks from text or adjacent block if present
      const marksMatch = text.match(/\[(\d+)\]|\((\d+)\s*Marks?\)/i) || (blocks[nextIdx]?.text || "").match(/^\[(\d+)\]$/);
      if (marksMatch) {
        marks = parseInt(marksMatch[1] || marksMatch[2], 10);
        text = text.replace(/\[\d+\]|\(\d+\s*Marks?\)/gi, "").trim();
      }

      // Collect following text lines before next question
      while (nextIdx < blocks.length) {
        const nextB = blocks[nextIdx];
        if (nextB.text.match(/^(\d{1,2})\s*[\.\)]/) || nextB.text.match(/^\([a-d]\)\s*/) || nextB.text.startsWith("SECTION")) {
          break;
        }
        if (nextB.bbox[1] - combinedBbox[3] < 0.05) {
          if (!nextB.text.startsWith("[") && nextB.text.length > 2) {
            text += (text.length ? " " : "") + nextB.text;
          }
          combinedBbox[2] = Math.max(combinedBbox[2], nextB.bbox[2]);
          combinedBbox[3] = Math.max(combinedBbox[3], nextB.bbox[3]);
        }
        nextIdx++;
      }

      if (text.length > 3 || num.length > 0) {
        // Expand bbox to readable page width
        const finalBbox = [
          Number(Math.max(0.04, combinedBbox[0]).toFixed(4)),
          Number(Math.max(0, combinedBbox[1] - 0.005).toFixed(4)),
          Number(Math.min(0.96, Math.max(combinedBbox[2], 0.92)).toFixed(4)),
          Number(Math.min(1, combinedBbox[3] + 0.005).toFixed(4)),
        ];

        questions.push({
          id: `q${questions.length + 1}`,
          number: num,
          originalLabel: `${num}.`,
          normalizedNumber: num.toLowerCase().replace(/[\(\)]/g, ""),
          text: text || `Question ${num}`,
          page: 1,
          bbox: finalBbox,
          marks,
          confidence: Number((b.conf || 0.95).toFixed(2)),
        });
      }
    }
  }
  return questions;
}

const qs = parseQuestionsFromOcr(qBlocks);
console.log(`Extracted ${qs.length} questions:`);
for (const q of qs) {
  console.log(`  [Q${q.number}] (${q.marks}m) "${q.text}" bbox: [${q.bbox}]`);
}







