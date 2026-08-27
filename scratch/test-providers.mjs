import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

async function testGroq() {
  console.log('Testing Groq...');
  const key = env.GROQ_API_KEY;
  if (!key) { console.log('No Groq key'); return; }
  
  for (const model of ['llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview', 'qwen/qwen3.6-27b']) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say hello and return JSON {"status":"ok"}' }],
          response_format: { type: 'json_object' }
        })
      });
      const data = await res.json();
      console.log(`Groq [${model}] status:`, res.status, data.choices?.[0]?.message?.content?.slice(0, 100) || data);
    } catch (e) {
      console.log(`Groq [${model}] err:`, e.message);
    }
  }
}

async function testGLM() {
  console.log('\nTesting GLM...');
  const key = env.GLM_API_KEY;
  for (const baseUrl of ['https://open.bigmodel.cn/api/paas/v4', 'https://api.z.ai/api/paas/v4']) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-4.6v-flash',
          messages: [{ role: 'user', content: 'Say hello in JSON {"status":"ok"}' }]
        })
      });
      const data = await res.json();
      console.log(`GLM [${baseUrl}] status:`, res.status, data.choices?.[0]?.message?.content?.slice(0, 100) || data);
    } catch (e) {
      console.log(`GLM [${baseUrl}] err:`, e.message);
    }
  }
}

async function testMonyet() {
  console.log('\nTesting Monyet / tokenin...');
  const key = env.MONYET_API_KEY;
  const baseUrl = env.MONYET_BASE_URL || 'https://tokenin.my.id/v1';
  const model = env.MONYET_MODEL || 'myt/gemini-3.5-flash-free';
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say hello in JSON {"status":"ok"}' }]
      })
    });
    const data = await res.json();
    console.log(`Monyet [${model}] status:`, res.status, data.choices?.[0]?.message?.content?.slice(0, 100) || data);
  } catch (e) {
    console.log(`Monyet err:`, e.message);
  }
}

async function testNvidia() {
  console.log('\nTesting Nvidia...');
  const key = env.NVIDIA_API_KEY;
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        messages: [{ role: 'user', content: 'Say hello in JSON {"status":"ok"}' }]
      })
    });
    const data = await res.json();
    console.log('Nvidia status:', res.status, data.choices?.[0]?.message?.content?.slice(0, 100) || data);
  } catch (e) {
    console.log('Nvidia err:', e.message);
  }
}

async function run() {
  await testGroq();
  await testGLM();
  await testMonyet();
  await testNvidia();
}
run();
