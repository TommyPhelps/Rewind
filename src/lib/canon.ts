// Title normalization, ported unchanged from the REWIND artifact so that
// library entries, the legacy reference table and series lists keep matching
// exactly as they did before the migration.

const ROMAN: Record<string, number> = {
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};

const EDITION =
  / (game of the year edition|game of the year|goty edition|goty|definitive edition|special edition|remastered|enhanced edition|complete edition|deluxe edition|ultimate edition|anniversary edition|directors cut|gold edition|legacy edition|standard edition|premium edition|collectors edition|hd|redux|digital deluxe|digital deluxe edition)$/;

export function canon(title: unknown): string {
  let s = String(title ?? "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\(\d{4}\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  s = s
    .split(" ")
    .map((x, i) => (i > 0 && ROMAN[x] ? String(ROMAN[x]) : x))
    .join(" ");
  for (let i = 0; i < 4; i++) {
    const n = s.replace(EDITION, "");
    if (n === s) break;
    s = n;
  }
  return s.replace(/^the /, "").trim();
}

/** Strips trademark symbols for display while keeping the user's title otherwise intact. */
export function cleanTitle(title: string): string {
  return title.replace(/[™®©]/g, "").replace(/\s{2,}/g, " ").trim();
}

/** Case-insensitive, accent-insensitive text used for search. */
export function searchKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
