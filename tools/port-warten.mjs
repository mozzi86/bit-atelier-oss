// port-warten.mjs — waits until the local BIT-Atelier server answers (plan 83-03).
// Used by start-windows.cmd and start.sh to open the browser only once the app is
// reachable: the first start may install packages for minutes before the server
// listens, and a browser opened too early shows "connection refused".
//
// Usage: node tools/port-warten.mjs [port=3001] [timeout in seconds=120]
// In:  port and timeout. Out: exit code 0 as soon as GET /api/status answers
//      (any HTTP status), 1 after the timeout. No dependency, Node ≥ 18.
// Asks 127.0.0.1 directly: the server binds IPv4 loopback, and "localhost" may
// resolve to ::1 first.

import http from 'node:http';

const port = Number(process.argv[2]) || 3001;
const timeoutSekunden = Number(process.argv[3]) || 120;
const INTERVALL_MS = 500;
const ende = Date.now() + timeoutSekunden * 1000;

/**
 * One probe request.
 * @returns {Promise<boolean>} true when the server answered at all
 */
function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

while (Date.now() < ende) {
  if (await probe()) process.exit(0);
  await new Promise((r) => setTimeout(r, INTERVALL_MS));
}
console.error(`[port-warten] http://127.0.0.1:${port} did not answer within ${timeoutSekunden} s.`);
process.exit(1);
