import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/store.tsx";
import { Icon } from "./Icon.tsx";

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
  xl,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  wide?: boolean;
  /** Nearly full-window, for previews with many rows. */
  xl?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button.primary, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="shade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"dlg" + (wide ? " wide" : "") + (xl ? " xl" : "")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="hd">
          <span>{title}</span>
          <button className="btn ghost icon sm x" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="bd">{children}</div>
        {footer && <div className="ft">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const { confirmState: c } = useApp();
  if (!c) return null;
  return (
    <Modal
      title={c.title}
      onClose={() => c.resolve(false)}
      footer={
        <>
          <button className="btn" onClick={() => c.resolve(false)}>
            Cancel
          </button>
          <button className={"btn primary" + (c.danger ? " danger" : "")} onClick={() => c.resolve(true)}>
            {c.ok ?? "OK"}
          </button>
        </>
      }
    >
      <div>{c.body}</div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast" + (t.err ? " err" : "")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export interface MenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  heading?: string;
  separator?: boolean;
  onClick?(): void;
}

/** Right-click menu positioned at the cursor and kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLElement>("button")?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length]?.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={pos} role="menu" onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <hr key={i} />
        ) : it.heading ? (
          <div key={i} className="lbl">
            {it.heading}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : undefined}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon ? <Icon name={it.icon} /> : <span style={{ width: "1.05rem" }} />}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
