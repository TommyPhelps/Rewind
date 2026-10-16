import { useEffect, useRef, useState } from "react";
import { cleanTitle } from "../lib/canon.ts";
import { STATUSES, SOURCE_LABEL, type Game, type Status } from "../lib/types.ts";
import { Icon } from "./Icon.tsx";
import { artSrc } from "../platform/native.ts";

export function StatusPill({ status }: { status: Status }) {
  const s = STATUSES.find((x) => x.id === status)!;
  return <span className={"st st-" + status}>{s.label}</span>;
}

/**
 * The cached cover when there is one (portrait art; a landscape Steam header is shown
 * centred on a blurred copy of itself, never stretched). Otherwise a neutral placeholder
 * that is the same for every game: it shows the title and says plainly there's no art yet.
 */
export function Cover({ game, eager }: { game: Pick<Game, "title" | "coverPath" | "favorite"> & { metaSource?: Record<string, string> }; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = artSrc(game.coverPath);
  const show = src && failed !== src ? src : null;
  const landscape = game.metaSource?.cover?.endsWith(":landscape") ?? false;
  return (
    <div className={"cover" + (show ? " has-art" : "") + (show && landscape ? " land" : "")}>
      {show ? (
        landscape ? (
          <>
            <img className="bg" src={show} alt="" loading={eager ? "eager" : "lazy"} aria-hidden="true" />
            <img className="fg" src={show} alt="" loading={eager ? "eager" : "lazy"} onError={() => setFailed(show)} />
          </>
        ) : (
          <img src={show} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(show)} />
        )
      ) : (
        <div className="ph" aria-hidden="true">
          <span className="noart">no art yet</span>
          <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="5" width="18" height="14" />
            <path d="M3 15l5-4 4 3 3-2 6 4" />
          </svg>
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

/** Small cached-cover thumbnail; an empty frame when there's no art (never a made-up image). */
export function Thumb({ file, className }: { file: string | null; className?: string }) {
  const [bad, setBad] = useState(false);
  const src = artSrc(file);
  return <div className={"thumb" + (className ? " " + className : "")} aria-hidden="true">{src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} /> : null}</div>;
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
  const est = source === "legacy_table" || source === "legacy" || source === "ai_estimate" || source === "reference";
  return (
    <span className={"badge" + (est ? " est" : source === "user" ? " you" : "")} title={SOURCE_LABEL[source === "legacy" ? "legacy_table" : source] ?? source}>
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
