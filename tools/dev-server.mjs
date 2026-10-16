// Serves dist-preview/ and a tiny SQL bridge backed by node:sqlite, so the UI can be
// exercised in a normal browser with the same SQL the desktop app runs.
// Usage: node tools/dev-server.mjs [port] [db-file]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
// Phase 3: network calls are answered by the INVENTED fake Steam/IGDB used in the tests,
// and "downloaded" art is a generated image that says TEST ART, so nothing real is faked.
import { fakeTransport, fakeSteamFolder, FAKE_APPS } from "../tests/fakeServices.ts";

const net = fakeTransport({ failAfter: process.env.REWIND_DEV_OFFLINE ? 0 : undefined });
const artDir = mkdtempSync(join(tmpdir(), "rewind-art-"));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function testArt(name) {
  const m = /steam-(\d+)-(cover|header|hero)/.exec(name) ?? [];
  const app = FAKE_APPS.find((a) => a.appid === Number(m[1]));
  const kind = m[2] ?? "cover";
  const [w, h] = kind === "cover" ? [600, 900] : kind === "hero" ? [1920, 620] : [460, 215];
  const hue = (Number(m[1] ?? 7) * 47) % 360;
  const title = esc(app?.name ?? name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},40%,12%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="${h * 0.42}" fill="#fff" font-family="Segoe UI, sans-serif" font-size="${kind === "cover" ? 44 : 30}" font-weight="700" text-anchor="middle">${title.length > 26 ? title.slice(0, 24) + "…" : title}</text><text x="50%" y="${h * 0.6}" fill="#ffffffaa" font-family="monospace" font-size="${kind === "cover" ? 26 : 16}" text-anchor="middle">TEST ART · ${kind} · not a real cover</text></svg>`;
}

const port = Number(process.argv[2] || 4173);
const db = new DatabaseSync(process.argv[3] || ":memory:");
db.exec("PRAGMA foreign_keys = ON");
const dist = resolve(import.meta.dirname, "../dist-preview");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const asyncOps = {
  http: async ({ req }) => net.request(req),
  art: async ({ url, name }) => {
    await net.download(url, name); // same 404 rules as the tests
    writeFileSync(join(artDir, name + ".svg"), testArt(name));
    return { file: `artwork/${name}.svg`, bytes: 1 };
  },
  art_missing: async ({ files }) => files.filter((f) => !existsSync(join(artDir, f.replace(/^artwork\//, "")))),
  steam_local: async () => fakeSteamFolder(),
};

const ops = {
  select: ({ sql, params }) => db.prepare(sql).all(...(params ?? [])),
  execute: ({ sql, params }) => {
    const r = db.prepare(sql).run(...(params ?? []));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  },
  batch: ({ statements }) => {
    let n = 0;
    db.exec("BEGIN");
    try {
      for (const s of statements) n += Number(db.prepare(s.sql).run(...(s.params ?? [])).changes);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return n;
  },
};

createServer((req, res) => {
  if (req.url.startsWith("/__rewind_dev/")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const op = req.url.split("/").pop();
      Promise.resolve()
        .then(() => (asyncOps[op] ? asyncOps[op](JSON.parse(body)) : ops[op](JSON.parse(body))))
        .then((result) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result })))
        .catch((e) => res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e.message || e) })));
    });
    return;
  }
  if (req.url.startsWith("/artwork/")) {
    const f = join(artDir, req.url.slice(9).split("?")[0].replace(/[^A-Za-z0-9._-]/g, ""));
    if (!existsSync(f)) return res.writeHead(404).end();
    return res.writeHead(200, { "content-type": "image/svg+xml" }).end(readFileSync(f));
  }
  const p = resolve(dist, "." + (req.url === "/" ? "/index.html" : req.url.split("?")[0]));
  if (!p.startsWith(dist) || !existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }).end(readFileSync(p));
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
