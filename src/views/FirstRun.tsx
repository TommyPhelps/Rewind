import { useApp } from "../state/store.tsx";
import type { Nav } from "../App.tsx";
import { Icon, Logo } from "../ui/Icon.tsx";
import { pickJsonFile } from "../platform/native.ts";

export function FirstRun({ nav }: { nav: Nav }) {
  const { finishFirstRun, run } = useApp();
  const pick = async (title: string) => {
    const f = await run(() => pickJsonFile(title));
    if (f) nav.startImport(f);
  };
  return (
    <div className="welcome">
      <div className="logo">
        <Logo />
        <div>
          <b>REWIND</b>
          <div className="dim mono" style={{ fontSize: "var(--fs-s)" }}>your library lives on this PC</div>
        </div>
      </div>
      <p style={{ margin: 0 }}>
        Bring your games over first. You'll see exactly what will be imported before anything is saved.
      </p>
      <div className="panel choice">
        <Icon name="rewind" />
        <div>
          <b>Import from the REWIND artifact</b>
          <div className="dim" style={{ fontSize: "var(--fs-s)" }}>
            The JSON file from the old app's "Download backup" button (or the export Claude made for you). Keeps playtime, statuses, notes and your Up Next order.
          </div>
        </div>
        <button className="btn primary" onClick={() => pick("Choose your REWIND artifact backup")}>
          <Icon name="upload" /> Choose file…
        </button>
      </div>
      <div className="panel choice">
        <Icon name="folder" />
        <div>
          <b>Restore a REWIND 2 backup</b>
          <div className="dim" style={{ fontSize: "var(--fs-s)" }}>A backup saved from this app's Settings.</div>
        </div>
        <button className="btn" onClick={() => pick("Choose a REWIND 2 backup")}>
          Choose file…
        </button>
      </div>
      <div className="panel choice">
        <Icon name="plus" />
        <div>
          <b>Start with an empty library</b>
          <div className="dim" style={{ fontSize: "var(--fs-s)" }}>You can import later from Settings → Data &amp; backup.</div>
        </div>
        <button className="btn" onClick={() => void finishFirstRun()}>
          Start empty
        </button>
      </div>
    </div>
  );
}
