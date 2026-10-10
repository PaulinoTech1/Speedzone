// Exercise the production Host routing through local HTTP gateways. Browsers
// cannot override Host with extra headers; each port represents one domain.
import http from "node:http";
import { spawn } from "node:child_process";

const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "4186"], { stdio: "inherit", env: process.env });
const gateways = [
  [4183, "localhost:4183"],
  [4184, "admin-inventory.speedzonems.com"],
  [4185, "security-console.speedzonems.com"],
].map(([port, host]) => {
  const server = http.createServer((request, response) => {
    const upstream = http.request({ hostname: "localhost", port: 4186, path: request.url, method: request.method, headers: { ...request.headers, host } }, result => {
      response.writeHead(result.statusCode || 502, result.headers); result.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(503); response.end("Test application starting"); });
    request.pipe(upstream);
  });
  server.listen(port, "localhost");
  return server;
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const server of gateways) server.close();
  app.kill("SIGTERM");
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
app.on("exit", code => { stop(); process.exitCode = code || 0; });
