// Interpose only in this test process. The imported evaluator and every actual subject are production code.
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const originalOpen = fs.open;
const originalSpawn = childProcess.spawn;
let swapped;
fs.open = async function (path, ...args) {
  const file = await originalOpen(path, ...args);
  if (typeof path !== 'string' || !path.includes('/aba/')) return file;
  const close = file.close.bind(file);
  file.close = async () => {
    await close();
    if (!swapped) {
      swapped = { path, original: readFileSync(path) };
      chmodSync(path, 0o600);
      writeFileSync(path, 'invalid protected fixture bytes');
      chmodSync(path, 0o400);
    }
  };
  return file;
};
childProcess.spawn = function (...args) {
  if (swapped && !swapped.restored) {
    if (readFileSync(swapped.path, 'utf8') !== 'invalid protected fixture bytes') throw new Error('Swap was not in place');
    chmodSync(swapped.path, 0o600);
    writeFileSync(swapped.path, swapped.original);
    chmodSync(swapped.path, 0o400);
    swapped.restored = true;
  }
  if (process.argv[1].includes('execution-failure')) throw new Error('Simulated subject startup failure');
  return originalSpawn(...args);
};
syncBuiltinESMExports();
await import('../../src/financial-attestation-evaluator.ts');
