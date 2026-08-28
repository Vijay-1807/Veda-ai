const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const root = path.resolve(__dirname, "..");
const referenceDir = path.join(root, "VedaAI Hiring Assignment");
const currentDir = path.join(__dirname, "acceptance-shots");
const pairs = [
  ["Upload Screen - Empty State.png", "desktop-upload-empty.png"],
  ["Upload Screen - filled state.png", "desktop-upload-filled.png"],
  ["Upload Screen - Empty State (phone).png", "mobile-upload-empty.png"],
  ["Upload Screen - filled state (phone).png", "mobile-upload-filled.png"],
  ["Loading state.png", "desktop-loading.png"],
  ["Loading state (phone).png", "mobile-loading.png"],
  ["Question - Answer mapping screen.png", "desktop-results.png"],
  ["Question - Answer mapping screen - Question toggle (phone).png", "mobile-results-questions.png"],
  ["Question - Answer mapping screen - answer toggle (phone).png", "mobile-results-answers.png"],
];

function cropTop(png, rows) {
  const cropped = new PNG({ width: png.width, height: png.height - rows });
  PNG.bitblt(png, cropped, 0, rows, png.width, png.height - rows, 0, 0);
  return cropped;
}

let compared = 0;
for (const [referenceName, currentName] of pairs) {
  const referencePath = path.join(referenceDir, referenceName);
  const currentPath = path.join(currentDir, currentName);
  if (!fs.existsSync(referencePath) || !fs.existsSync(currentPath)) throw new Error(`Missing comparison file: ${referenceName} or ${currentName}`);
   const rawReference = PNG.sync.read(fs.readFileSync(referencePath));
   const reference = referenceName.includes("(phone)") ? cropTop(rawReference, 105) : rawReference;
  const current = PNG.sync.read(fs.readFileSync(currentPath));
  if (reference.width !== current.width || reference.height !== current.height) {
    throw new Error(`Dimension mismatch for ${currentName}: reference ${reference.width}x${reference.height}, current ${current.width}x${current.height}`);
  }
  const diff = new PNG({ width: reference.width, height: reference.height });
  const changed = pixelmatch(reference.data, current.data, diff.data, reference.width, reference.height, { threshold: 0.1 });
  const ratio = changed / (reference.width * reference.height);
  fs.writeFileSync(path.join(currentDir, `diff-${currentName}`), PNG.sync.write(diff));
  console.log(`${currentName}: ${(ratio * 100).toFixed(2)}% changed (${changed} pixels)`);
  compared++;
}
console.log(`Compared ${compared}/${pairs.length} reference states.`);
