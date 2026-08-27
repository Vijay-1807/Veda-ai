import fs from 'fs';
import { createOrderedProviders } from './lib/ai/registry.ts';

// Read .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    process.env[match[1]] = (match[2] || '').trim();
  }
}

async function run() {
  const providers = createOrderedProviders();
  console.log('Active providers in order:', providers.map(p => p.name).join(' -> '));
  
  if (providers.length === 0) {
    console.log('No providers available');
    return;
  }
  
  const provider = providers[0];
  console.log('Testing primary provider:', provider.name);
  
  // Use DPS logo as sample
  const sampleBuf = fs.readFileSync('DPS logo.png');
  const file = {
    name: 'DPS logo.png',
    mimeType: 'image/png',
    data: sampleBuf.toString('base64')
  };
  
  const t0 = Date.now();
  try {
    const questions = await provider.extractQuestions(file);
    console.log(`Questions extracted: ${questions.length} in ${Date.now() - t0}ms`);
    console.log('Questions:', JSON.stringify(questions, null, 2));
  } catch (e) {
    console.error('Extraction error:', e);
  }
}

run();
