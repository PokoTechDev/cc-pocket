import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashPin } from '../server/auth.js';

const PIN_REGEX = /^\d{4}$/;

export function isValidPinFormat(pin) {
  return typeof pin === 'string' && PIN_REGEX.test(pin);
}

export function savePin(pin, pinFile) {
  if (!isValidPinFormat(pin)) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  const stored = hashPin(pin);
  mkdirSync(dirname(pinFile), { recursive: true });
  writeFileSync(pinFile, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  return stored;
}

async function runCli() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pinFile = join(__dirname, '..', 'data', 'pin.json');

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const pin1 = (await rl.question('Enter 4-digit PIN: ')).trim();
    if (!isValidPinFormat(pin1)) {
      console.error('[CC Pocket] error: PIN must be exactly 4 digits.');
      process.exitCode = 1;
      return;
    }
    const pin2 = (await rl.question('Confirm PIN: ')).trim();
    if (pin1 !== pin2) {
      console.error('[CC Pocket] error: PINs do not match.');
      process.exitCode = 1;
      return;
    }
    savePin(pin1, pinFile);
    console.log(`[CC Pocket] info: PIN saved to ${pinFile} (mode 0600).`);
  } finally {
    rl.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli().catch((err) => {
    console.error(`[CC Pocket] error: ${err.message}`);
    process.exit(1);
  });
}
