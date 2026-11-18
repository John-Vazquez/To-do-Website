import { pathToFileURL } from 'node:url';
import { stdin, stdout } from 'node:process';
import { randomBytes, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const PROJECT_REF = 'walsvybskelqhgvpdagj';
const pbkdf2Async = promisify(pbkdf2);

export function readHidden(label) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
  return new Promise((resolve, reject) => {
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = chunk => {
      for (const key of chunk.toString('utf8')) {
        if (key === '\u0003') { cleanup(); reject(new Error('Canceled.')); return; }
        if (key === '\r' || key === '\n') { cleanup(); resolve(value); return; }
        if (key === '\u007f' || key === '\b') value = value.slice(0, -1);
        else if (key >= ' ' && key <= '~') value += key;
      }
    };
    stdin.on('data', onData);
  });
}

export async function makePinHash(pin, salt = randomBytes(32)) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly four digits.');
  const derived = await pbkdf2Async(pin, salt, 600_000, 32, 'sha256');
  return `pbkdf2-sha256$600000$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function uploadPinHash(hash, token, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'TODO_PIN_HASH', value: hash }])
  });
  if (!response.ok) throw new Error(`Supabase rejected the secret update (HTTP ${response.status}). Check token permissions and try again.`);
}

async function choosePinHash() {
  const pin = await readHidden('Choose a 4-digit PIN (input hidden): ');
  const confirm = await readHidden('Enter the PIN again: ');
  if (pin !== confirm) throw new Error('PIN entries did not match.');
  return makePinHash(pin);
}

async function copyPinHash() {
  if (process.platform !== 'win32') throw new Error('Clipboard setup is available on Windows.');
  const hash = await choosePinHash();
  await new Promise((resolve, reject) => {
    const clipboard = spawn('clip.exe', { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    clipboard.on('error', reject);
    clipboard.on('close', code => code === 0 ? resolve() : reject(new Error('Could not copy the PIN hash.')));
    clipboard.stdin.on('error', reject);
    clipboard.stdin.end(hash);
  });
  console.log('PIN hash copied. Paste it as the value of TODO_PIN_HASH in the To-Do project’s Edge Function Secrets and click Save.');
}

export async function main(token = process.env.SUPABASE_ACCESS_TOKEN) {
    if (!token) token = await readHidden('Supabase access token (input hidden): ');
    const hash = await choosePinHash();
    await uploadPinHash(hash, token);
    console.log('PIN hash saved as TODO_PIN_HASH in Supabase Secrets. The PIN was not printed or saved to disk.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const setup = process.argv.includes('--copy-hash') ? copyPinHash() : main(process.argv.includes('--prompt-token') ? '' : process.env.SUPABASE_ACCESS_TOKEN);
  setup.catch(error => { console.error(error.message); process.exitCode = 1; });
}
