import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json" };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/api/evidence") {
    const deploymentRoot = fileURLToPath(new URL("../deployments/", import.meta.url));
    const names = [
      "coston2-shadowrouter-v2.json",
      "coston2-mint-deposit-v2.json",
      "coston2-fcc-extension.json",
      "coston2-fcc-evaluation-v2.json",
      "coston2-pangolin-adapter-v2.json",
      "coston2-pangolin-execution-v2.json",
      "coston2-redemption-request.json",
    ];
    const evidence = {};
    for (const name of names) { try { evidence[name.replace(/\.json$/, "")] = JSON.parse(await readFile(join(deploymentRoot, name), "utf8")); } catch {} }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(evidence)); return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "Content-Type": types[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(target).pipe(response);
  } catch { response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`ShadowRoute demo: http://127.0.0.1:${port}`));
