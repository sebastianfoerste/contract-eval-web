import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

const portServer = net.createServer();
portServer.listen(0, '127.0.0.1');
await once(portServer, 'listening');
const port = portServer.address().port;
portServer.close();
await once(portServer, 'close');

const origin = `http://127.0.0.1:${port}`;
// Only the debug level shows uncaught runtime exceptions. One answer sent before
// its request body was read raises such an exception every time, while the stalled
// request it can cause in Wrangler's local proxy depends on timing.
const server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--inspector-port', '0', '--port', String(port), '--log-level', 'debug'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const uncaught = [];
for (const stream of [server.stdout, server.stderr]) {
  let partial = '';
  stream.on('data', chunk => {
    const text = chunk.toString();
    log = (log + text).slice(-10000);
    const lines = (partial + text).split('\n');
    partial = lines.pop();
    uncaught.push(...lines.filter(line => line.includes('uncaught exception')));
  });
}

try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null && server.signalCode === null) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* The local Worker is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Local Worker did not start. ${log}`);
  const check = spawn(process.execPath, ['tests/api-check.mjs', origin], { stdio: 'inherit' });
  const checkTimer = setTimeout(() => check.kill('SIGKILL'), 120000);
  const [code, signal] = await once(check, 'exit');
  clearTimeout(checkTimer);
  if (code !== 0) throw new Error(`${signal ? `API contract check was stopped after 120 s (${signal}).` : `API contract check exited with status ${code}.`}\nLocal Worker output:\n${log}`);
  if (uncaught.length) throw new Error(`The local Worker reported ${uncaught.length} uncaught exception(s) during the API contract check:\n${uncaught.join('\n')}`);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    let timer;
    const exited = await Promise.race([stopped.then(() => true), new Promise(resolve => { timer = setTimeout(resolve, 5000, false); })]);
    // A pending timer would keep this process alive for 5 s after Wrangler exited.
    clearTimeout(timer);
    // Wrangler ignoring SIGTERM would otherwise keep the port bound and this process alive.
    if (!exited) server.kill('SIGKILL');
  }
  for (const stream of [server.stdout, server.stderr]) stream.destroy();
}
