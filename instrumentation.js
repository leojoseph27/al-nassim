/* ==== WhatsApp Baileys service auto-start (development) ================
   `npx next dev` (and `npm run dev`) starts BOTH services:
     1. WhatsApp Baileys service  -> 127.0.0.1:4000  (whatsapp-service/)
     2. Next.js                   -> 0.0.0.0:3000

   Architecture: ALL Node process management lives in
   scripts/wa-service-manager.mjs — a plain Node helper spawned as a
   SEPARATE process. This file never imports Node builtins, so webpack
   never tries to bundle net/http/child_process into the Next build
   (the Next 15.5 instrumentation compile cannot resolve them).

   Behaviour (see scripts/wa-service-manager.mjs):
     - skipped when port 4000 is busy (no duplicate Baileys socket);
     - service spawned from whatsapp-service/ with its own .env
       (PORT=4000, HOST=127.0.0.1, AUTH_DIR=auth — existing session kept);
     - skipped for production start/build unless WA_SERVICE_AUTO_START=1;
     - the manager forwards service logs and waits for /health;
     - Ctrl+C (SIGINT on the console process group) stops BOTH — the
       manager also tree-kills the service as a safety net. ==== */
async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'development' && process.env.WA_SERVICE_AUTO_START !== '1') return;
  if (process.env.NASSIM_WA_STARTED === '1') return; // hot-reload re-entry guard
  process.env.NASSIM_WA_STARTED = '1';

  // Escaped require: keeps child_process OUT of the webpack dependency
  // graph entirely; at runtime (dev server inside Node) this resolves to
  // the real require. The manager script holds all process logic.
  const req = eval('require');
  const { spawn } = req('child_process');
  const manager = spawn(process.execPath, ['scripts/wa-service-manager.mjs'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  console.log('[wa-service] manager started (pid ' + manager.pid + ') — WhatsApp service on 127.0.0.1:4000, Next.js on 0.0.0.0:3000');

  // Safety net: if the Next server exits without a console signal (crash,
  // IDE stop), take the service's process tree down with it.
  const killManagerTree = () => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(manager.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(manager.pid, 'SIGTERM');
    } catch (e) { /* already gone */ }
  };
  process.once('exit', killManagerTree);
  process.once('SIGTERM', () => { killManagerTree(); process.exit(0); });
}

module.exports = { register };
