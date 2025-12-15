import { request } from 'undici';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CLOUD_CODE_URL = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
const USER_AGENT = 'GeminiCLI/0.1.5 (Linux; x86_64)';

async function testProxy() {
  const credPath = path.join(process.cwd(), 'test_cred.json');
  if (!fs.existsSync(credPath)) return;

  const content = fs.readFileSync(credPath, 'utf-8');
  const cred = JSON.parse(content);
  
  // Get Token
  const { body } = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const accessToken = (await body.json() as any).access_token;
  const projectId = cred.project_id || 'original-guru-460907-g1';

  // Test Models
  const models = [
    'gemini-pro',
    'models/gemini-pro',
    'gemini-1.5-pro',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ];

  for (const model of models) {
    console.log(`\nTesting Model: ${model}`);
    await tryModel(accessToken, projectId, model);
  }
}

async function tryModel(token: string, projectId: string, model: string) {
  const payload = {
    model: model,
    project: projectId,
    user_prompt_id: crypto.randomUUID(),
    request: {
      contents: [{ role: "user", parts: [{ text: "Hi" }] }]
    }
  };

  try {
    const { statusCode, body } = await request(CLOUD_CODE_URL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log(`Status: ${statusCode}`);
    if (statusCode === 200) {
      const resp = await body.json() as any;
      console.log('🎉 SUCCESS!', JSON.stringify(resp).substring(0, 100));
    } else {
      console.log('Error:', (await body.text()).substring(0, 100));
    }
  } catch (e) {}
}

testProxy();