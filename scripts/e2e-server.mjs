import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import next from "next";

const hostname = "localhost";
const port = 4183;
const shutdownPath = "/__speedzone_e2e_shutdown";
const expectedToken = process.env.E2E_SHUTDOWN_TOKEN ?? "";

if (Buffer.from(expectedToken, "base64url").length !== 32) {
  throw new Error("E2E_SHUTDOWN_TOKEN must be a 32-byte base64url test fixture");
}

// Playwright injects the deterministic E2E fixtures below via webServer.env
// before this process starts. Next's own startup loads .env* and expands any
// $identifier it finds there, including in variables this script never read
// from a file, whenever a developer's untracked local .env happens to define
// the same key. A stored Argon2 hash is mostly $-delimited segments, so on a
// machine with a real .env that expansion silently corrupts it. Snapshot the
// injected values now, before Next touches process.env, and restore them
// after prepare() so the fixtures stay byte-for-byte what Playwright set
// regardless of what an untracked .env contains.
const injectedEnv = { ...process.env };

const app = next({ dev: true, hostname, port });
const handle = app.getRequestHandler();
const sockets = new Set();
let shuttingDown = false;

function tokenMatches(provided) {
  const expected = Buffer.from(expectedToken, "utf8");
  const candidate = Buffer.from(provided ?? "", "utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function isLoopback(address) {
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

await app.prepare();
Object.assign(process.env, injectedEnv);

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${hostname}:${port}`);
  if (request.method === "POST" && requestUrl.pathname === shutdownPath) {
    const allowed =
      isLoopback(request.socket.remoteAddress) &&
      tokenMatches(request.headers["x-speedzone-e2e-token"]);
    if (!allowed) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(204);
    response.end(() => {
      setImmediate(() => void shutdown());
    });
    return;
  }

  void handle(request, response);
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
server.on("upgrade", app.getUpgradeHandler());

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const socket of sockets) socket.destroy();
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

server.listen(port, hostname, () => {
  console.log(`SpeedZone E2E server ready at http://${hostname}:${port}`);
});
