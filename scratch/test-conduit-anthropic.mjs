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

async function testAnthropicFormat() {
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const base64 = sampleBuf.toString('base64');

  console.log('Testing Conduit Anthropic /v1/messages endpoint...');
  try {
    const res = await fetch('https://conduit.ozdoev.net/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64
              }
            },
            {
              type: 'text',
              text: 'Extract questions as JSON: {"questions":[{"id":"q1","number":"1","text":"sample"}]}'
            }
          ]
        }]
      })
    });
    const data = await res.json();
    console.log('Anthropic format status:', res.status, JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.log('Anthropic error:', e.message);
  }
}

async function testClaudeOpus() {
  console.log('Testing Claude 3.5 / Opus on Conduit...');
  for (const model of ['claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-opus-4-8', 'gpt-5.6']) {
    try {
      const res = await fetch('https://conduit.ozdoev.net/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say hello in JSON {"status":"ok"}' }]
        })
      });
      const data = await res.json();
      console.log(`[${model}] status:`, res.status, JSON.stringify(data).slice(0, 200));
    } catch (e) {
      console.log(`[${model}] error:`, e.message);
    }
  }
}

async function run() {
  await testAnthropicFormat();
  await testClaudeOpus();
}
run();
