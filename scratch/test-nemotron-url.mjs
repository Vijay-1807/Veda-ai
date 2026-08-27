import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

const key = env.NVIDIA_OCR_API_KEY || env.NVIDIA_API_KEY;

async function testUrlField() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');

  console.log('Testing payload: input: [{ url: data:image/png;base64,... }]');
  const res = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: [
        {
          url: `data:image/png;base64,${base64}`
        }
      ]
    })
  });

  console.log(`Status: ${res.status}`);
  const data = await res.text();
  console.log('Response:\n', data.slice(0, 1000));
}

testUrlField();
