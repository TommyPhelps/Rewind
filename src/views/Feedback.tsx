import { useState } from "react";
import { useApp } from "../state/store.tsx";
import { Modal } from "../ui/Overlays.tsx";
import { cleanTitle } from "../lib/canon.ts";
import { DROP_REASONS, REASONS } from "../rec/taste.ts";

/** Asked once, right after you mark a single game Dropped or Completed. Always optional. */
export function FeedbackDialog() {
  const { feedbackFor, setFeedbackFor, gameById, addRecEvent, updateGame, toast } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  if (!feedbackFor) return null;
  const g = gameById.get(feedbackFor.gameId);
  if (!g) return null;
  const close = () => {
    setPicked([]);
    setFeedbackFor(null);
  };

  if (feedbackFor.kind === "completed") {
    const rate = async (r: number) => {
      await updateGame(g.id, { rating: r });
      close();
    };
    return (
      <Modal title="Finished" onClose={close} footer={<button className="btn ghost" onClick={close}>Skip</button>}>
        <p style={{ margin: 0 }}>
          How was <b>{cleanTitle(g.title)}</b>? <span className="dim">(Optional. It helps REWIND tell what you enjoy from what you just spent time on.)</span>
        </p>
        <div className="row">
          <button className="btn" onClick={() => rate(5)}>Loved it</button>
          <button className="btn" onClick={() => rate(4)}>Liked it</button>
          <button className="btn" onClick={() => rate(3)}>Mixed</button>
          <button className="btn" onClick={() => rate(2)}>Didn't enjoy it</button>
        </div>
      </Modal>
    );
  }

  const save = async () => {
    for (const r of picked) await addRecEvent("drop", g.id, r);
    if (picked.length) toast("Thanks. REWIND will weigh that in.");
    close();
  };
  return (
    <Modal
      title="Dropped"
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>Skip</button>
          <button className="btn primary" onClick={save} disabled={!picked.length}>Save</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        What made you stop <b>{cleanTitle(g.title)}</b>? <span className="dim">Optional, pick any. No judgement: it only shapes future suggestions, and grind/difficulty/setup reasons fade after 60 days.</span>
      </p>
      <div className="chips">
        {DROP_REASONS.map((k) => (
          <button
            key={k}
            className={"chip toggle" + (picked.includes(k) ? " on" : "")}
            aria-pressed={picked.includes(k)}
            onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
          >
            {REASONS[k].label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
