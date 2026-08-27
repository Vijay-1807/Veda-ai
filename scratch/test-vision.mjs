import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

// Read sample image if exists or create dummy 1x1 png base64
const samplePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function testMonyetVision() {
  console.log('Testing Monyet vision...');
  const key = env.MONYET_API_KEY;
  const baseUrl = env.MONYET_BASE_URL || 'https://tokenin.my.id/v1';
  const model = env.MONYET_MODEL || 'myt/gemini-3.5-flash-free';
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe what you see in this image and return JSON: {"description": "..."}' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${samplePngBase64}` } }
          ]
        }],
        response_format: { type: 'json_object' }
      })
    });
    const data = await res.json();
    console.log(`Monyet vision status:`, res.status, JSON.stringify(data.choices?.[0]?.message?.content || data));
  } catch (e) {
    console.log(`Monyet vision err:`, e.message);
  }
}

async function testGroqVision() {
  console.log('Testing Groq vision...');
  const key = env.GROQ_API_KEY;
  for (const model of ['qwen/qwen3.6-27b', 'meta-llama/llama-4-scout-preview', 'llama-3.3-70b-versatile']) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract questions as JSON: {"questions":[{"id":"q1","number":"1","text":"sample"}]}' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${samplePngBase64}` } }
            ]
          }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await res.json();
      console.log(`Groq [${model}] vision status:`, res.status, JSON.stringify(data.choices?.[0]?.message?.content || data));
    } catch (e) {
      console.log(`Groq [${model}] vision err:`, e.message);
    }
  }
}

async function run() {
  await testMonyetVision();
  await testGroqVision();
}
run();
