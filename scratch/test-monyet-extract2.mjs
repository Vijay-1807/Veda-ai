import fs from 'fs';

// Read .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

async function testMonyetExtraction() {
  const imgBuf = fs.readFileSync('DPS logo.png');
  const base64 = imgBuf.toString('base64');
  
  const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Return only JSON with this shape: {"questions":[{"id":"q1","number":"1","originalLabel":"1","normalizedNumber":"1","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}.`;
  
  const res = await fetch('https://tokenin.my.id/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.MONYET_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.MONYET_MODEL || 'myt/gemini-3.5-flash-free',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${QUESTION_PROMPT}\nIMPORTANT: Return ONLY valid JSON.` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
        ]
      }]
    })
  });
  
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response content:', data.choices?.[0]?.message?.content);
}

testMonyetExtraction().catch(console.error);
