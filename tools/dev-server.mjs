// Serves dist-preview/ and a tiny SQL bridge backed by node:sqlite, so the UI can be
// exercised in a normal browser with the same SQL the desktop app runs.
// Usage: node tools/dev-server.mjs [port] [db-file]
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.argv[2] || 4173);
const db = new DatabaseSync(process.argv[3] || ":memory:");
db.exec("PRAGMA foreign_keys = ON");
const dist = resolve(import.meta.dirname, "../dist-preview");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

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
      try {
        const result = ops[req.url.split("/").pop()](JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result }));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  const p = resolve(dist, "." + (req.url === "/" ? "/index.html" : req.url.split("?")[0]));
  if (!p.startsWith(dist) || !existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }).end(readFileSync(p));
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
