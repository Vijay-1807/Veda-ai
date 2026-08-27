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

async function probe() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');

  const testPayloads = [
    {
      name: "input array with image",
      body: {
        input: [`data:image/png;base64,${base64}`]
      }
    },
    {
      name: "input array with objects",
      body: {
        input: [{ image: `data:image/png;base64,${base64}` }]
      }
    },
    {
      name: "input array of image_url objects",
      body: {
        input: [{ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }]
      }
    },
    {
      name: "input array of messages",
      body: {
        input: [{
          role: "user",
          content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }]
        }]
      }
    }
  ];

  for (const t of testPayloads) {
    console.log(`\nTesting payload: ${t.name}...`);
    try {
      const res = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(t.body)
      });
      const data = await res.text();
      console.log(`Status: ${res.status}`, data.slice(0, 400));
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

probe();
