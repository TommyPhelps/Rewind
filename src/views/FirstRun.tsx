import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon, Logo } from "../ui/Icon.tsx";
import { pickJsonFile } from "../platform/native.ts";

/** Shown once, while the library is empty. */
export function FirstRun({ nav }: { nav: Nav }) {
  const { finishFirstRun, run } = useApp();
  const pick = async (title: string) => {
    const f = await run(() => pickJsonFile(title));
    if (f) nav.startImport(f);
  };
  return (
    <div className="welcome">
      <div className="row nowrap" style={{ gap: "var(--s3)" }}>
        <span style={{ width: "2.2rem", display: "inline-flex" }}>
          <Logo />
        </span>
        <h1>Welcome to REWIND</h1>
      </div>
      <p className="dim" style={{ margin: 0 }}>
        Your library lives on this PC. Bring your games in first — you'll see exactly what will be imported before anything is saved.
      </p>
      <div className="choice">
        <div className="stack tight">
          <b>Import from your launchers</b>
          <span className="meta">Steam (no key needed), Epic Games, Ubisoft Connect and Rockstar Games. Each asks before it looks at anything.</span>
        </div>
        <button className="btn primary" onClick={() => nav.settings("connections")}>
          <Icon name="download" /> Choose launchers…
        </button>
      </div>
      <div className="choice">
        <div className="stack tight">
          <b>Restore a REWIND backup</b>
          <span className="meta">A backup from any REWIND version, or the old artifact's export (keeps playtime, statuses, notes and Up Next).</span>
        </div>
        <button className="btn" onClick={() => void pick("Choose a REWIND backup")}>
          <Icon name="upload" /> Choose file…
        </button>
      </div>
      <div className="choice">
        <div className="stack tight">
          <b>Start with an empty library</b>
          <span className="meta">Add games one at a time; REWIND fills in details and artwork for you.</span>
        </div>
        <button className="btn" onClick={() => void finishFirstRun()}>
          Start empty
        </button>
      </div>
    </div>
  );
}
