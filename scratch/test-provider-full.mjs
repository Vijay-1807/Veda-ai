import fs from 'fs';
import { OpenAICompatibleVisionProvider } from './lib/ai/openai-compatible.ts';

// Read .env.local
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1]] = (match[2] || '').trim();
  }
}

// Set env for test
process.env.MONYET_API_KEY = env.MONYET_API_KEY;
process.env.MONYET_BASE_URL = env.MONYET_BASE_URL;
process.env.MONYET_MODEL = env.MONYET_MODEL;

const provider = new OpenAICompatibleVisionProvider({
  name: "monyet",
  apiKey: env.MONYET_API_KEY,
  baseUrl: env.MONYET_BASE_URL,
  model: env.MONYET_MODEL,
  timeoutMs: 45000
});

async function run() {
  const paperBuf = fs.readFileSync('DPS logo.png');
  const paperFile = {
    name: 'DPS logo.png',
    mimeType: 'image/png',
    data: paperBuf.toString('base64')
  };

  console.log('Extracting questions with Monyet...');
  const questions = await provider.extractQuestions(paperFile);
  console.log('Extracted questions:', questions.length);
}

run().catch(console.error);
