import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SERVER = fileURLToPath(new URL('../../../examples/shop/server.mjs', import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

export interface Shop {
  url: string;
  stop: () => Promise<void>;
}

/** Start examples/shop with BUG and SCENARIO. Requires `pnpm shop:build` first. */
export async function startShop(bug: string, scenario: 'bad' | 'good'): Promise<Shop> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), BUG: bug, SCENARIO: scenario }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((res, rej) => {
    let err = '';
    child.stdout!.on('data', (d: Buffer) => d.toString().includes('shop on') && res());
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => rej(new Error(`shop exited (${code}): ${err}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((res) => {
        if (child.exitCode !== null) return res();
        child.once('exit', () => res());
        child.kill();
      }),
  };
}
