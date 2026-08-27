import { readFileSync } from "node:fs";

const paperBase64 = readFileSync("C:\\Users\\Bonth\\Downloads\\image11.png").toString("base64");
const MONYET_API_KEY = process.env.MONYET_API_KEY || "Bearer-tokenin"; // will load from .env.local

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const envPath = resolve(ROOT, ".env.local");
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

const key = process.env.MONYET_API_KEY;
const model = process.env.MONYET_MODEL ?? "myt/gemini-3.5-flash-free";
const baseUrl = process.env.MONYET_BASE_URL ?? "https://tokenin.my.id/v1";

console.log("Testing Monyet with REAL image11.png (810KB)...");

const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Preserve the exact visible label in originalLabel and number. Split every labelled sub-part into a separate record: 11(a), 11(b), 11(i), 11(ii), 11(1), 11(2), 11(a)(i), and 11(a)(ii) are all different questions. Never merge subquestions or drop a suffix. Return normalizedNumber as the canonical equivalent: 11(a)->11a, 11(1)->11.1, 11(ii)->11ii, 11(a)(i)->11a.i. Do not convert 11.1 to 111 or 11.10 to 11a. If a label is genuinely unclear, preserve it and use a lower confidence rather than inventing a suffix. Return only JSON with this shape: {"questions":[{"id":"q1","number":"11(a)","originalLabel":"11(a)","normalizedNumber":"11a","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}. Coordinates are normalized 0..1 relative to the page. bbox=[x1,y1,x2,y2], with x1=left, y1=top, x2=right, y2=bottom. The bbox must surround the question number and text. Use null/omit bbox only when it cannot be located.`;

const payload = {
  model,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${QUESTION_PROMPT}\nIMPORTANT: Return ONLY valid raw JSON. No Markdown, no code fences, no <think> tags.\nThis is original PDF page 1. Preserve this page number in every region.`,
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${paperBase64}` },
        },
      ],
    },
  ],
  temperature: 0.1,
  stream: false,
  max_tokens: 4096,
};

console.log("Payload checks:");
console.log("- isArray(messages):", Array.isArray(payload.messages));
console.log("- messages.length:", payload.messages.length);
console.log("- messages[0].role:", payload.messages[0].role);
console.log("- isArray(messages[0].content):", Array.isArray(payload.messages[0].content));
console.log("- content[0].type:", payload.messages[0].content[0].type);
console.log("- content[1].type:", payload.messages[0].content[1].type);

const t0 = Date.now();
const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

console.log(`HTTP ${res.status} in ${Date.now() - t0}ms`);
const text = await res.text();
console.log("Response:", text.slice(0, 500));
