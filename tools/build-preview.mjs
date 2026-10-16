// Builds a plain-browser preview of the UI (no Tauri) with esbuild, for screenshots
// and quick checks. The real app is built by Vite + Tauri (see README).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shim = resolve(root, "tools/preview-shims/tauri.ts");
const nodePaths = (process.env.PREVIEW_NODE_PATH || "").split(":").filter(Boolean);
mkdirSync(resolve(root, "dist-preview"), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/main.tsx")],
  bundle: true,
  outdir: resolve(root, "dist-preview"),
  format: "esm",
  jsx: "automatic",
  target: "chrome110",
  nodePaths,
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".woff2": "file", ".woff": "file" },
  plugins: [{
    name: "shims",
    setup(b) {
      b.onResolve({ filter: /^@tauri-apps\// }, () => ({ path: shim }));
      b.onResolve({ filter: /^@fontsource\// }, () => ({ path: resolve(root, "tools/preview-shims/empty.css") }));
    },
  }],
});
const html = readFileSync(resolve(root, "index.html"), "utf8")
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="/main.css"><script type="module" src="/main.js"></script>');
writeFileSync(resolve(root, "dist-preview/index.html"), html);
console.log("preview built");
