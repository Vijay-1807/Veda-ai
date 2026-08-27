import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !(match[1] in env)) env[match[1]] = match[2].trim();
}

const providers = [
  ["groq", "GROQ_API_KEY", "GROQ_BASE_URL", env.GROQ_MODEL || "qwen/qwen3.6-27b"],
  ["nararouter-stepfun", "NARAROUTER_API_KEY", "NARAROUTER_BASE_URL", "stepfun-3.7-flash"],
  ["nararouter-minimax", "NARAROUTER_API_KEY", "NARAROUTER_BASE_URL", "minimax-m3-free"],
  ["monyet", "MONYET_API_KEY", "MONYET_BASE_URL", env.MONYET_MODEL || "myt/gemini-3.5-flash-free"],
  ["glm46", "GLM_API_KEY", "GLM_BASE_URL", env.GLM_MODEL || "glm-4.6v-flash"],
  ["nemotron", "NVIDIA_API_KEY", "NVIDIA_BASE_URL", env.NVIDIA_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
  ["navyai-gemini25", "NAVYAI_API_KEY", "NAVYAI_BASE_URL", env.NAVYAI_MODEL || "gemini-2.5-flash"],
  ["conduit", "CONDUIT_API_KEY", "CONDUIT_BASE_URL", env.CONDUIT_MODEL || "gemini-2.5-flash"],
];

const { createCanvas, loadImage } = await import("@napi-rs/canvas");
const sourceImage = await loadImage(fs.readFileSync("C:\\Users\\Bonth\\Downloads\\image11.png"));
const smokeWidth = 512;
const smokeHeight = Math.max(1, Math.round(sourceImage.height * smokeWidth / sourceImage.width));
const smokeCanvas = createCanvas(smokeWidth, smokeHeight);
smokeCanvas.getContext("2d").drawImage(sourceImage, 0, 0, smokeWidth, smokeHeight);
const image = smokeCanvas.toBuffer("image/jpeg").toString("base64");
const prompt = 'Read the visible document image and return only JSON: {"visible":true}.';

for (const [name, keyEnv, baseEnv, model] of providers) {
  const key = env[keyEnv];
  const base = env[baseEnv];
  if (!key || !base) {
    console.log(JSON.stringify({ provider: name, model, configured: false, status: "SKIP" }));
    continue;
  }
  const started = Date.now();
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
        ] }],
        temperature: 0,
        max_tokens: 32,
        stream: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    console.log(JSON.stringify({
      provider: name,
      model,
      configured: true,
      status: response.status,
      latencyMs: Date.now() - started,
      visionSuccess: response.ok && /visible|true/i.test(text),
      reason: response.ok ? "response received" : text.slice(0, 120),
    }));
  } catch (error) {
    console.log(JSON.stringify({ provider: name, model, configured: true, status: "ERROR", latencyMs: Date.now() - started, visionSuccess: false, reason: error.message }));
  }
}

if (env.GEMINI_API_KEY) {
  const started = Date.now();
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || "gemini-3.6-flash"}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: image } }] }], generationConfig: { maxOutputTokens: 32 } }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    console.log(JSON.stringify({ provider: "gemini36", model: env.GEMINI_MODEL || "gemini-3.6-flash", configured: true, status: response.status, latencyMs: Date.now() - started, visionSuccess: response.ok && /visible|true/i.test(text), reason: response.ok ? "response received" : text.slice(0, 120) }));
  } catch (error) {
    console.log(JSON.stringify({ provider: "gemini36", model: env.GEMINI_MODEL || "gemini-3.6-flash", configured: true, status: "ERROR", latencyMs: Date.now() - started, visionSuccess: false, reason: error.message }));
  }
}
