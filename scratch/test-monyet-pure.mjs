import fs from 'fs';
import path from 'path';

// Read .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

async function testExtraction() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');
  
  const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Return only JSON with this shape: {"questions":[{"id":"q1","number":"1","originalLabel":"1","normalizedNumber":"1","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}.`;
  
  console.log('Testing Monyet Gemini 3.5 Flash...');
  const t0 = Date.now();
  const res = await fetch('https://tokenin.my.id/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.MONYET_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.MONYET_MODEL || 'myt/gemini-3.5-flash-free',
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: QUESTION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
        ]
      }]
    })
  });
  
  console.log(`Status: ${res.status} in ${Date.now() - t0}ms`);
  const data = await res.json();
  console.log('Result choices:', data.choices?.[0]?.message?.content?.slice(0, 300));
}

testExtraction();
