import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

const QUESTION_PROMPT = `You are extracting a printed exam question paper. Extract every question in printed order. Preserve the exact visible label in originalLabel and number. Split every labelled sub-part into a separate record: 11(a), 11(b), 11(i), 11(ii), 11(1), 11(2), 11(a)(i), and 11(a)(ii) are all different questions. Never merge subquestions or drop a suffix. Return normalizedNumber as the canonical equivalent: 11(a)->11a, 11(1)->11.1, 11(ii)->11ii, 11(a)(i)->11a.i. If a label is genuinely unclear, preserve it and use a lower confidence rather than inventing a suffix. Return only JSON with this shape: {"questions":[{"id":"q1","number":"1","originalLabel":"1","normalizedNumber":"1","page":1,"bbox":[0.1,0.1,0.9,0.2],"marks":2,"confidence":0.96}]}. Coordinates are normalized 0..1 relative to the page. bbox=[x1,y1,x2,y2], with x1=left, y1=top, x2=right, y2=bottom.`;

async function testExtraction() {
  const imgBuffer = fs.readFileSync('DPS logo.png');
  const base64 = imgBuffer.toString('base64');
  
  const key = env.MONYET_API_KEY;
  const baseUrl = env.MONYET_BASE_URL || 'https://tokenin.my.id/v1';
  const model = env.MONYET_MODEL || 'myt/gemini-3.5-flash-free';

  console.log(`Sending extraction request to Monyet (${model})...`);
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
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
  
  console.log(`HTTP ${res.status} in ${Date.now() - t0}ms`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  console.log('Response content:\n', content?.slice(0, 500));
}

testExtraction();
