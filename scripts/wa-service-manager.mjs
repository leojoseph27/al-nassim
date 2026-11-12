/* ==== WhatsApp service manager (plain Node, NOT bundled by Next) ========
   Spawned by instrumentation.js when `npx next dev` starts. Owns the
   Baileys service child process for the lifetime of the dev server:
     - refuses to start a duplicate service (port 4000 in use);
     - spawns whatsapp-service/dist/server.js with PORT=4000 /
       HOST=127.0.0.1 forced (the parent sets PORT=3000, which must not
       leak into the service);
     - waits for /health before declaring success;
     - forwards service logs to the main terminal;
     - kills the service (process tree) when the manager itself exits
       (Ctrl+C sends SIGINT to the whole console group; this handler is
       the safety net for any other exit path).
   Never deletes anything under whatsapp-service/auth/ — the saved
   WhatsApp session must survive restarts. ==== */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';

const SERVICE_PORT = 4000;
const SERVICE_URL = 'http://127.0.0.1:4000';

const portBusy = await new Promise((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(true));
  probe.listen(SERVICE_PORT, '127.0.0.1', () => probe.close(() => resolve(false)));
});
if (portBusy) {
  console.log('[wa-service] port 4000 already in use — assuming the WhatsApp service is already running, not starting a duplicate.');
  process.exit(0);
}

const service = spawn(process.execPath, ['dist/server.js'], {
  cwd: 'whatsapp-service',
  env: { ...process.env, PORT: String(SERVICE_PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: true,
});
console.log('[wa-service] Baileys service starting (pid ' + service.pid + ') from whatsapp-service/ — Next.js will serve 0.0.0.0:3000');

const shutdown = () => {
  if (service.exitCode !== null || service.signalCode) process.exit(0);
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(service.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(service.pid, 'SIGTERM');
  } catch (e) { /* already gone */ }
  // Give the tree a moment, then force the manager to follow.
  setTimeout(() => process.exit(0), 3000);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
service.once('exit', () => process.exit(0));

// Wait for /health so the log clearly shows when the service is usable.
const started = Date.now();
const poll = async () => {
  try {
    const r = await fetch(SERVICE_URL + '/health');
    await r.arrayBuffer?.catch?.(() => {});
    if (r.ok) {
      console.log('[wa-service] WhatsApp service is up on ' + SERVICE_URL + ' (/health OK)');
      return;
    }
  } catch (e) { /* not up yet */ }
  if (Date.now() - started > 30000) { console.log('[wa-service] WARNING: /health not OK within 30s'); return; }
  setTimeout(poll, 500);
};
poll();
