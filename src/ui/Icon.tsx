// Small square-cap stroke icons, drawn for REWIND (no icon font, works offline).
const P: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.6l3.8-1 3.7 15.5-3.8.9z",
  discover: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  pick: "M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01",
  mods: "M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  activity: "M3 12h4l2.5-6 5 12 2.5-6H21",
  collections: "M4 8h16v12H4zM6 5h12M8 2h8",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  x: "M5 5l14 14M19 5 5 19",
  plus: "M12 4v16M4 12h16",
  left: "M15 4 7 12l8 8",
  right: "M9 4l8 8-8 8",
  up: "M4 15l8-8 8 8",
  down: "M4 9l8 8 8-8",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M4 6h16M4 12h16M4 18h16",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  check: "M4 12.5 9.5 18 20 6",
  alert: "M12 3 2 20h20zM12 10v4M12 17v.5",
  play: "M7 4v16l13-8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
  folder: "M3 6h6l2 2h10v11H3z",
  sidebar: "M3 4h18v16H3zM9 4v16",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  rewind: "M3 5v14M20 5l-8 7 8 7zM12 5 4 12l8 7z",
};

export function Icon({ name, className, title }: { name: keyof typeof P | string; className?: string; title?: string }) {
  return (
    <svg className={className ?? "ico"} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={P[name] ?? P.alert} />
    </svg>
  );
}

/** The REWIND mark used in the sidebar and welcome screen. */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" fill="var(--panel2)" stroke="var(--accent)" strokeWidth="1.5" />
      <rect x="7" y="10" width="2" height="12" fill="var(--title-fg)" />
      <path d="M10 16l7-6v12z" fill="var(--title-fg)" />
      <path d="M17 16l7-6v12z" fill="var(--accent)" />
    </svg>
  );
}
