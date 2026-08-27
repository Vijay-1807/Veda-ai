import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

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

async function optimizeImage(buffer, maxDim = 1280) {
  const img = await loadImage(buffer);
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
    size: jpegBuf.length,
    dimensions: `${w}x${h}`,
  };
}

const paperBuf = readFileSync("C:\\Users\\Bonth\\Downloads\\image11.png");
const answerBuf = readFileSync("C:\\Users\\Bonth\\Downloads\\image12.png");

const optPaper = await optimizeImage(paperBuf);
const optAnswer = await optimizeImage(answerBuf);

console.log("Optimized paper:", optPaper.dimensions, optPaper.size, "bytes");
console.log("Optimized answer:", optAnswer.dimensions, optAnswer.size, "bytes");

// Test Groq with optimized paper
const groqKey = process.env.GROQ_API_KEY;
const groqModel = process.env.GROQ_MODEL ?? "qwen/qwen3.6-27b";
const groqBase = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";

const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Return only JSON with this shape: {"questions":[{"id":"q1","number":"21","originalLabel":"21","normalizedNumber":"21","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}.`;

console.log("\n--- Testing Groq Questions with Optimized Image ---");
const t0 = Date.now();
const gqRes = await fetch(`${groqBase}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: groqModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: QUESTION_PROMPT + "\nReturn ONLY raw JSON." },
          { type: "image_url", image_url: { url: `data:${optPaper.mimeType};base64,${optPaper.data}` } }
        ]
      }
    ],
    max_completion_tokens: 4096,
    reasoning_effort: "none",
    temperature: 0.1,
  })
});

console.log(`Groq Questions: HTTP ${gqRes.status} in ${Date.now() - t0}ms`);
const gqJson = await gqRes.json();
const qContent = gqJson.choices?.[0]?.message?.content ?? "";
console.log("Questions response (first 300 chars):", qContent.slice(0, 300));

// Now test Answer extraction with Groq, and if 429, with Monyet!
const answerPrompt = (questions) => `You are extracting a student's handwritten answer sheet. Detect every answer including its exact original label and bounding box. Return JSON: {"answers":[{"id":"a1","questionNumber":"21","originalLabel":"21","normalizedQuestionNumber":"21","text":"...","regions":[{"page":1,"bbox":[0.1,0.1,0.9,0.2],"confidence":0.9}],"confidence":0.9}]}. Available questions: ${JSON.stringify(questions)}`;

let questions = [];
try {
  questions = JSON.parse(qContent).questions || [];
  console.log(`Extracted ${questions.length} questions from paper!`);
} catch {
  console.log("Using fallback question list");
  questions = [{ number: "21", normalizedNumber: "21", text: "Q21" }];
}

console.log("\n--- Testing Groq Answers ---");
const t1 = Date.now();
const gaRes = await fetch(`${groqBase}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: groqModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: answerPrompt(questions.slice(0, 5)) + "\nReturn ONLY raw JSON." },
          { type: "image_url", image_url: { url: `data:${optAnswer.mimeType};base64,${optAnswer.data}` } }
        ]
      }
    ],
    max_completion_tokens: 4096,
    reasoning_effort: "none",
    temperature: 0.1,
  })
});

console.log(`Groq Answers: HTTP ${gaRes.status} in ${Date.now() - t1}ms`);
if (!gaRes.ok) {
  console.log("Groq Answers Error:", await gaRes.text());
  
  // Test fallback to Monyet for Answers!
  console.log("\n--- Testing Monyet Fallback for Answers ---");
  const monyetKey = process.env.MONYET_API_KEY;
  const monyetModel = process.env.MONYET_MODEL ?? "myt/gemini-3.5-flash-free";
  const monyetBase = process.env.MONYET_BASE_URL ?? "https://tokenin.my.id/v1";

  const t2 = Date.now();
  const maRes = await fetch(`${monyetBase}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${monyetKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: monyetModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: answerPrompt(questions.slice(0, 5)) + "\nReturn ONLY raw JSON." },
            { type: "image_url", image_url: { url: `data:${optAnswer.mimeType};base64,${optAnswer.data}` } }
          ]
        }
      ],
      max_tokens: 4096,
      temperature: 0.1,
    })
  });
  console.log(`Monyet Answers: HTTP ${maRes.status} in ${Date.now() - t2}ms`);
  const maText = await maRes.text();
  console.log("Monyet Answers response (first 400 chars):", maText.slice(0, 400));
} else {
  const gaJson = await gaRes.json();
  console.log("Groq Answers SUCCESS:", (gaJson.choices?.[0]?.message?.content ?? "").slice(0, 300));
}
