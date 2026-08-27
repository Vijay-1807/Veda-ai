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

console.log({ MONYET_API_KEY: !!MONYET_API_KEY, MODEL, BASE_URL });

const testImagePath = resolve(ROOT, "DPS logo.png");
const imageBase64 = readFileSync(testImagePath).toString("base64");

// Test 1: standard chat/completions
console.log("\n--- Test 1: Standard Chat Completions with image_url ---");
try {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MONYET_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello! What is in this image?" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } }
          ]
        }
      ]
    })
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
} catch (e) {
  console.error("Test 1 error:", e);
}

// Test 2: Text only
console.log("\n--- Test 2: Text only ---");
try {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MONYET_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: "Hello! Reply with 'OK'."
        }
      ]
    })
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
} catch (e) {
  console.error("Test 2 error:", e);
}
