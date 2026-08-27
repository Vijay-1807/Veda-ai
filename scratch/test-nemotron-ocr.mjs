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
console.log('Using NVIDIA key:', key ? `${key.slice(0, 10)}...` : 'NONE');

// Test endpoints:
// 1. https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2
// 2. https://integrate.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2
// 3. https://integrate.api.nvidia.com/v1/chat/completions with model nvidia/nemotron-ocr-v2

async function testNvOcr() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');

  const endpoints = [
    {
      url: 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2',
      body: {
        image: `data:image/png;base64,${base64}`
      }
    },
    {
      url: 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2',
      body: {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract OCR' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }]
      }
    },
    {
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      body: {
        model: 'nvidia/nemotron-ocr-v2',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Perform OCR and layout detection.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }]
      }
    }
  ];

  for (const ep of endpoints) {
    console.log(`\nTesting endpoint: ${ep.url} ...`);
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ep.body)
      });
      const data = await res.text();
      console.log(`Status: ${res.status}`, data.slice(0, 300));
    } catch (e) {
      console.log(`Error:`, e.message);
    }
  }
}

testNvOcr();
