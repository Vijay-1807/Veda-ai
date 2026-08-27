const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const pairs = [
  ['VedaAI Hiring Assignment/Upload Screen - Empty State.png', 'scripts/shots/reference-size-desk-upload.png', 'desktop upload'],
  ['VedaAI Hiring Assignment/Upload Screen - Empty State (phone).png', 'scripts/shots/reference-size-mob-upload.png', 'mobile upload'],
];

for (const [referencePath, currentPath, label] of pairs) {
  if (!fs.existsSync(currentPath)) continue;
  const reference = PNG.sync.read(fs.readFileSync(referencePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));
  if (reference.width !== current.width || reference.height !== current.height) {
    console.log(label, 'dimension mismatch', { reference: [reference.width, reference.height], current: [current.width, current.height] });
    continue;
  }
  const diff = new PNG({ width: reference.width, height: reference.height });
  const changed = pixelmatch(reference.data, current.data, diff.data, reference.width, reference.height, { threshold: 0.1 });
  fs.writeFileSync(`scripts/shots/diff-${label.replaceAll(' ', '-')}.png`, PNG.sync.write(diff));
  console.log(label, { width: reference.width, height: reference.height, changedPixels: changed, ratio: Number((changed / (reference.width * reference.height)).toFixed(4)) });
}
