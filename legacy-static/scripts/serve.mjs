import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function localFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const cleaned = decoded === "/" ? decoded : decoded.replace(/\/+$/, "");
  const relative = cleaned === "/" ? "index.html" : cleaned.replace(/^\/+/, "");
  const candidates = extname(relative) ? [relative] : [`${relative}.html`, `${relative}/index.html`];

  for (const candidate of candidates) {
    const file = resolve(root, candidate);
    if ((file === root || file.startsWith(`${root}${sep}`)) && existsSync(file) && statSync(file).isFile()) {
      return file;
    }
  }

  return null;
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const pathname = new URL(request.url || "/", `http://${host}:${port}`).pathname;
  const requestedFile = localFile(pathname);
  const file = requestedFile || resolve(root, "404.html");
  const status = requestedFile ? 200 : 404;
  const body = readFileSync(file);

  response.writeHead(status, {
    "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : body);
});

server.listen(port, host, () => {
  console.log(`SpeedZone preview: http://${host}:${port}/`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
