const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const shots = path.join(__dirname, "acceptance-shots");
const questionImage = path.resolve(root, "..", "image11.png");
const answerImage = path.resolve(root, "..", "image12.png");
const questionFixture = JSON.parse(fs.readFileSync(path.join(root, "scratch", "gemma4-31b-questions.json"), "utf8"));
const answerFixture = JSON.parse(fs.readFileSync(path.join(root, "scratch", "gemma4-31b-answers.json"), "utf8"));
fs.mkdirSync(shots, { recursive: true });

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function ready(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
}

async function attachImages(page) {
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(questionImage);
  await inputs.nth(1).setInputFiles(answerImage);
  await page.waitForTimeout(250);
}

async function captureUpload(browser, name, viewport, filled) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width <= 860, hasTouch: viewport.width <= 860, deviceScaleFactor: 1 });
  await page.goto("http://localhost:3000");
  await ready(page);
  if (filled) await attachImages(page);
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.close();
}

function appViewport(viewport) {
  return viewport.width <= 860 ? { ...viewport, height: viewport.height - 105 } : viewport;
}

async function captureLoading(browser, name, viewport) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width <= 860, hasTouch: viewport.width <= 860, deviceScaleFactor: 1 });
  await page.route("**/api/extract", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "visual fixture" }) });
  });
  await page.goto("http://localhost:3000");
  await ready(page);
  await attachImages(page);
  await page.locator(".start-btn").click();
  await page.locator(".processing-card").waitFor();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.close();
}

async function captureResults(browser, name, viewport, answerTab) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width <= 860, hasTouch: viewport.width <= 860, deviceScaleFactor: 1 });
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...questionFixture, ...answerFixture }),
    });
  });
  await page.goto("http://localhost:3000");
  await ready(page);
  await attachImages(page);
  await page.locator(".start-btn").click();
  await page.locator(".results-page").waitFor({ timeout: 10000 });
  await page.locator(".paper-page img").waitFor({ state: "attached", timeout: 5000 });
  await page.locator(".paper-page img").evaluate((image) => image.complete && image.naturalWidth > 0);
  if (answerTab) await page.locator(".mobile-tab").nth(1).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.close();
}

async function auditViewport(browser, width, height) {
  const mobile = width <= 860;
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000");
  await ready(page);
  const rootOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const startHeight = await page.locator(".start-btn").evaluate((element) => element.getBoundingClientRect().height);
  check(`${width}x${height} no horizontal overflow`, !rootOverflow);
  check(`${width}x${height} start button >=44px`, startHeight >= 43.5, `${startHeight.toFixed(1)}px`);

  await page.goto("http://localhost:3000/?demo=1");
  await ready(page);
  const toolbarOverflow = await page.locator(".viewer-toolbar").evaluate((element) => element.scrollWidth > element.clientWidth).catch(() => false);
  check(`${width}x${height} results toolbar fits`, !toolbarOverflow);
  check(`${width}x${height} no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

async function auditPdfFlow(browser) {
  const fixturePage = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  const createPdf = async (imagePath, outputName) => {
    const image = fs.readFileSync(imagePath).toString("base64");
    await fixturePage.setContent(`<style>html,body{margin:0}img{display:block;width:100%;height:auto}</style><img src="data:image/png;base64,${image}">`);
    await fixturePage.locator("img").evaluate((element) => element.complete && element.naturalWidth > 0);
    const outputPath = path.join(shots, outputName);
    await fixturePage.pdf({ path: outputPath, width: "1000px", height: "1400px", printBackground: true, pageRanges: "1" });
    return outputPath;
  };
  const paperPdf = await createPdf(questionImage, "question-fixture.pdf");
  const answerPdf = await createPdf(answerImage, "answer-fixture.pdf");
  await fixturePage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questions: [
          { id: "q1", number: "1", originalLabel: "1", text: "First PDF question", page: 1, bbox: [0.1,0.1,0.8,0.2], marks: 2, confidence: 0.95 },
          { id: "q2", number: "2", originalLabel: "2", text: "Second PDF question", page: 1, bbox: [0.1,0.3,0.8,0.4], marks: 3, confidence: 0.95 },
          { id: "q3", number: "3", originalLabel: "3", text: "Third PDF question", page: 1, bbox: [0.1,0.5,0.8,0.6], marks: 5, confidence: 0.95 }
        ],
        answers: [
          { id: "a1", questionNumber: "1", originalLabel: "1", text: "First answer", regions: [{ page: 1, bbox: [0.08,0.08,0.92,0.2], confidence: 0.95 }], confidence: 0.95 },
          { id: "a2", questionNumber: "2", originalLabel: "2", text: "Second answer", regions: [{ page: 1, bbox: [0.08,0.28,0.92,0.42], confidence: 0.95 }], confidence: 0.95 }
        ]
      })
    });
  });
  await page.goto("http://localhost:3000");
  await ready(page);
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(paperPdf);
  await inputs.nth(1).setInputFiles(answerPdf);
  check("PDF question upload accepted", (await page.locator(".filled-meta b").nth(0).textContent()) === "question-fixture.pdf");
  check("PDF answer upload accepted", (await page.locator(".filled-meta b").nth(1).textContent()) === "answer-fixture.pdf");
  await page.locator(".start-btn").click();
  await page.locator(".results-page").waitFor({ timeout: 10000 });
  await page.locator(".q-card-top").first().click();
  await page.locator(".paper-page canvas").waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector(".paper-page canvas");
    return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
  });
  const canvasSize = await page.locator(".paper-page canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  check("PDF answer page rendered", canvasSize.width > 0 && canvasSize.height > 0, `${canvasSize.width}x${canvasSize.height}`);
  check("PDF bbox highlight rendered", await page.locator(".answer-highlight").count() === 1);
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  await captureUpload(browser, "desktop-upload-empty", { width: 1440, height: 787 }, false);
  await captureUpload(browser, "desktop-upload-filled", { width: 1440, height: 787 }, true);
  await captureUpload(browser, "mobile-upload-empty", appViewport({ width: 393, height: 853 }), false);
  await captureUpload(browser, "mobile-upload-filled", appViewport({ width: 393, height: 853 }), true);
  await captureLoading(browser, "desktop-loading", { width: 1440, height: 788 });
  await captureLoading(browser, "mobile-loading", appViewport({ width: 393, height: 853 }));
  await captureResults(browser, "desktop-results", { width: 1440, height: 1580 }, false);
  await captureResults(browser, "mobile-results-questions", { width: 393, height: 2122 }, false);
  await captureResults(browser, "mobile-results-answers", appViewport({ width: 393, height: 872 }), true);

  for (const [width, height] of [[320,568],[360,640],[393,853],[768,1024],[860,800],[861,800],[1024,768],[1366,768],[1440,900]]) {
    await auditViewport(browser, width, height);
  }
  await auditPdfFlow(browser);

  await browser.close();
  const failed = checks.filter((result) => !result.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} responsive checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
