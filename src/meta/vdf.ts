// Valve KeyValues ("VDF") text, as used by Steam's libraryfolders.vdf, appmanifest_*.acf
// and localconfig.vdf. Keys and values are quoted strings; sections are { … }.
// Valve treats keys case-insensitively, so lookups here do too.

export type Vdf = { [key: string]: string | Vdf };

export function parseVdf(text: string): Vdf {
  let i = 0;
  const n = text.length;

  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
  };

  const token = (): string | "{" | "}" | null => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === "{" || c === "}") {
      i++;
      return c;
    }
    if (c === '"') {
      i++;
      let out = "";
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const e = text[i + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
        } else out += text[i++];
      }
      i++; // closing quote
      return out;
    }
    // Unquoted token (rare): up to whitespace or a brace.
    let out = "";
    while (i < n && !/[\s{}"]/.test(text[i])) out += text[i++];
    return out;
  };

  const section = (): Vdf => {
    const obj: Vdf = {};
    for (;;) {
      const k = token();
      if (k === null || k === "}") return obj;
      if (k === "{") continue; // stray brace: ignore
      const v = token();
      if (v === null) return obj;
      if (v === "{") obj[k] = section();
      else if (v === "}") return obj;
      else obj[k] = v;
    }
  };

  return section();
}

/** Case-insensitive child lookup along a path. */
export function vdfGet(v: Vdf | string | undefined, ...path: string[]): Vdf | string | undefined {
  let cur: Vdf | string | undefined = v;
  for (const p of path) {
    if (!cur || typeof cur === "string") return undefined;
    const want = p.toLowerCase();
    const key: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === want);
    cur = key === undefined ? undefined : cur[key];
  }
  return cur;
}

export function vdfObj(v: Vdf | string | undefined): Vdf | undefined {
  return v && typeof v === "object" ? v : undefined;
}

export function vdfStr(v: Vdf | string | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
