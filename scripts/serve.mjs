import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.env.PORT ?? 8000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = normalize(join(rootDir, `.${sep}${pathname.replace(/^\/+/, "")}`));
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": types[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(port, () => {
  console.log(`POC local em http://localhost:${port}/index.html`);
});
