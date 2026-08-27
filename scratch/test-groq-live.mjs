#!/usr/bin/env node
/**
 * Live test: Groq Qwen 3.6 27B with the fixed request format
 * Usage: node scratch/test-groq-live.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Load .env.local
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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b";
const BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";

if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY not set in .env.local");
  process.exit(1);
}

// Use DPS logo as test image if available
const testImagePath = resolve(ROOT, "DPS logo.png");
let imageBase64 = "";
let mimeType = "image/png";

if (existsSync(testImagePath)) {
  imageBase64 = readFileSync(testImagePath).toString("base64");
  console.log("Using DPS logo.png as test image");
} else {
  console.error("Test image not found: DPS logo.png");
  process.exit(1);
}

const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Preserve the exact visible label. Return only JSON with this shape: {"questions":[{"id":"q1","number":"1","originalLabel":"1","normalizedNumber":"1","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}.`;

const body = {
  model: MODEL,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: QUESTION_PROMPT + "\nReturn ONLY valid raw JSON. No Markdown, no <think> tags.",
        },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${imageBase64}` },
        },
      ],
    },
  ],
  temperature: 0.1,
  max_completion_tokens: 4096,
  reasoning_effort: "none",
  stream: false,
};

console.log(`\nTesting Groq ${MODEL} at ${BASE_URL}...`);
const t0 = Date.now();

const res = await fetch(`${BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const elapsed = Date.now() - t0;
console.log(`\nHTTP ${res.status} in ${elapsed}ms`);

const data = await res.text();
if (!res.ok) {
  console.error("ERROR:", data.slice(0, 500));
  process.exit(1);
}

const parsed = JSON.parse(data);
const content = parsed.choices?.[0]?.message?.content ?? "";
console.log(`\nResponse (first 800 chars):\n${content.slice(0, 800)}`);

// Try to parse the JSON
try {
  const json = JSON.parse(content);
  console.log(`\n✅ Valid JSON! questions: ${json.questions?.length ?? 0}, answers: ${json.answers?.length ?? 0}`);
} catch {
  console.warn("\n⚠️  Response is not direct JSON — checking for embedded JSON...");
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const json = JSON.parse(match[0]);
      console.log(`✅ Extracted JSON! questions: ${json.questions?.length ?? 0}`);
    } catch {
      console.error("❌ Could not parse JSON from response");
    }
  }
}
