import { readFileSync, existsSync } from "node:fs";
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

const MONYET_API_KEY = process.env.MONYET_API_KEY;
const MODEL = process.env.MONYET_MODEL ?? "myt/gemini-3.5-flash-free";
const BASE_URL = process.env.MONYET_BASE_URL ?? "https://tokenin.my.id/v1";

const testImagePath = resolve(ROOT, "DPS logo.png");
const imageBase64 = readFileSync(testImagePath).toString("base64");

const prompt = "You are extracting a printed exam question paper. Extract every question in printed order. Return only JSON with this shape: {\"questions\":[]}.";

const userContent = [
  {
    type: "text",
    text: `${prompt}\nIMPORTANT: Return ONLY valid raw JSON. No Markdown, no code fences, no <think> tags.\nThis is original PDF page 1. Preserve this page number in every region.`,
  },
  {
    type: "image_url",
    image_url: { url: `data:image/png;base64,${imageBase64}` },
  },
];

// Test with exact payload from openai-compatible.ts:
console.log("\n--- Testing Monyet with response_format and max_tokens ---");
const body1 = {
  model: MODEL,
  messages: [{ role: "user", content: userContent }],
  temperature: 0.1,
  stream: false,
  max_tokens: 4096,
  response_format: { type: "json_object" },
};

console.log("messages isArray:", Array.isArray(body1.messages));
console.log("messages[0].content isArray:", Array.isArray(body1.messages[0].content));

const res1 = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${MONYET_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body1),
});

console.log("Status 1:", res1.status);
console.log("Body 1:", await res1.text());

// Test without response_format
console.log("\n--- Testing Monyet WITHOUT response_format ---");
const body2 = {
  model: MODEL,
  messages: [{ role: "user", content: userContent }],
  temperature: 0.1,
  stream: false,
  max_tokens: 4096,
};

const res2 = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${MONYET_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body2),
});

console.log("Status 2:", res2.status);
console.log("Body 2:", await res2.text());
