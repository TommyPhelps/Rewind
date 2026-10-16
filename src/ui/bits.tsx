import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cleanTitle } from "../lib/canon.ts";
import { STATUSES, SOURCE_LABEL, type Game, type Status } from "../lib/types.ts";
import { Icon } from "./Icon.tsx";

export function StatusPill({ status }: { status: Status }) {
  const s = STATUSES.find((x) => x.id === status)!;
  return <span className={"st st-" + status}>{s.label}</span>;
}

function hueOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}

function initials(title: string): string {
  const words = cleanTitle(title)
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(" ")
    .filter((w) => w && !/^(the|of|a|an|and)$/i.test(w));
  return (words.slice(0, 3).map((w) => w[0]).join("") || "?").toUpperCase();
}

/** Cover art, or a generated placeholder tile when no artwork is cached yet. */
export function Cover({ game }: { game: Pick<Game, "title" | "coverPath" | "favorite"> }) {
  const [failed, setFailed] = useState(false);
  const src = game.coverPath && !failed ? game.coverPath : null;
  return (
    <div className="cover" style={{ "--h": String(hueOf(game.title)) } as unknown as CSSProperties}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="ph" aria-hidden="true">
          <span className="ini">{initials(game.title)}</span>
          <span className="t">{cleanTitle(game.title)}</span>
        </div>
      )}
      {game.favorite && (
        <span className="fav">
          <Icon name="star" />
        </span>
      )}
    </div>
  );
}

export function Stars({ value, onChange }: { value: number | null; onChange?(v: number | null): void }) {
  if (!onChange) {
    return value ? <span className="rating ro" aria-label={`${value} of 5`}>{"★".repeat(value)}</span> : <span className="dim">—</span>;
  }
  return (
    <span className="rating" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={value != null && n <= value ? "on" : ""}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          title={value === n ? "Click again to clear" : `${n} of 5`}
          onClick={() => onChange(value === n ? null : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const est = source === "legacy_table" || source === "ai_estimate";
  return (
    <span className={"badge" + (est ? " est" : source === "user" ? " you" : "")} title={SOURCE_LABEL[source] ?? source}>
      {source === "user" ? "you" : est ? "est." : source}
    </span>
  );
}

/** Text input that saves on blur or Enter rather than on every keystroke. */
export function CommitInput({
  value,
  onCommit,
  className = "field",
  placeholder,
  type = "text",
  ariaLabel,
}: {
  value: string;
  onCommit(v: string): void;
  className?: string;
  placeholder?: string;
  type?: string;
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    setV(value);
    last.current = value;
  }, [value]);
  const commit = () => {
    if (v !== last.current) {
      last.current = v;
      onCommit(v);
    }
  };
  return (
    <input
      className={className}
      value={v}
      type={type}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(last.current);
          e.stopPropagation();
        }
      }}
    />
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
