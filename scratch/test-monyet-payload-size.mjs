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

const key = process.env.MONYET_API_KEY;
const model = process.env.MONYET_MODEL ?? "myt/gemini-3.5-flash-free";
const baseUrl = process.env.MONYET_BASE_URL ?? "https://tokenin.my.id/v1";

const rawBuffer = readFileSync("C:\\Users\\Bonth\\Downloads\\image11.png");

// Let's test different chunk sizes of base64
console.log("Original raw size:", rawBuffer.length, "bytes. Base64 length:", rawBuffer.toString("base64").length);

for (const size of [100000, 200000, 300000, 400000, 500000, 800000]) {
  const slice = rawBuffer.subarray(0, size);
  const b64 = slice.toString("base64");
  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this image? Reply briefly in JSON: {\"text\":\"...\"}" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 100,
  };

  const bodyStr = JSON.stringify(payload);
  const t0 = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: bodyStr,
  });
  console.log(`Size ${size} (payload ${bodyStr.length} chars) -> HTTP ${res.status} in ${Date.now() - t0}ms`);
  if (!res.ok) {
    console.log("  Error:", (await res.text()).slice(0, 150));
    break;
  }
}
