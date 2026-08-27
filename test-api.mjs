const fs = require("fs");
const path = require("path");

async function test() {
  const form = new FormData();
  const testFile = fs.readFileSync(path.join(__dirname, "test-files", "test-white.png"));
  const blob = new Blob([testFile], { type: "image/png" });
  form.append("paper", blob, "test-paper.png");
  form.append("answers", blob, "test-answers.png");
  
  console.log("Sending request to /api/extract...");
  const start = Date.now();
  try {
    const res = await fetch("http://localhost:3000/api/extract", { method: "POST", body: form });
    console.log(`Status: ${res.status} (${Date.now() - start}ms)`);
    const body = await res.json();
    console.log("Response:", JSON.stringify(body, null, 2).slice(0, 2000));
  } catch (err) {
    console.error("Fetch error:", err.message);
  }
}
test();
