import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

const key = env.CONDUIT_API_KEY;
const baseUrl = env.CONDUIT_BASE_URL || 'https://conduit.ozdoev.net/v1';

async function testConduitModels() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');
  
  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-3-pro',
    'grok-3',
    'grok-4',
    'gpt-4o-mini',
    'gpt-4o'
  ];

  for (const model of models) {
    console.log(`Testing Conduit with model: ${model}...`);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract questions as JSON: {"questions":[{"id":"q1","number":"1","text":"sample"}]}' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
            ]
          }],
          max_tokens: 1000
        })
      });
      const data = await res.json();
      console.log(`[${model}] Status: ${res.status}`, JSON.stringify(data).slice(0, 200));
    } catch (e) {
      console.log(`[${model}] Error:`, e.message);
    }
  }
}

testConduitModels();
