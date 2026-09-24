import type { MemoryDocument, Routine, RunActivityRow, ScratchpadItem } from "@rakazo/contracts";
import { ArrowRight, Check, ChevronRight, Clock3, Lightbulb, MessageCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rpc } from "../lib/rpc";
import "./personal-workspace.css";

type Tab = "for-you" | "goals" | "ideas" | "activity" | "memory";
type Source = "items" | "routines" | "runs" | "memory";
type ChatTarget = { botId: string; groupId?: string; draft?: string };
const tabs: { id: Tab; label: string }[] = [
  { id: "for-you", label: "For you" }, { id: "goals", label: "Goals" },
  { id: "ideas", label: "Ideas" }, { id: "activity", label: "Activity" },
  { id: "memory", label: "Memory" },
];
const waiting = (run: RunActivityRow) => run.status === "waiting_input" || run.status === "waiting_takeover";
const working = (run: RunActivityRow) => run.status === "queued" || run.status === "leased" || run.status === "running";
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};
function statusLabel(status: RunActivityRow["status"]) {
  const labels: Record<RunActivityRow["status"], string> = {
    queued: "Queued", leased: "Starting", running: "Working",
    waiting_input: "Needs your answer", waiting_takeover: "Needs your help",
    completed: "Done", failed: "Couldn't finish", cancelled: "Stopped",
  };
  return labels[status];
}
function memoryTitle(document: MemoryDocument): string {
  const filename = document.path.split("/").filter(Boolean).pop() ?? "";
  if (!filename || /^\.?memory\.md$/i.test(filename)) return document.scope === "user" ? "About you" : "Assistant memory";
  return filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
}

export function PersonalWorkspace({
  botId, botIds, onClose, onOpenChat, assistantName = "Negroni", embedded = true,
}: {
  botId: string;
  botIds: readonly string[];
  onClose: () => void;
  onOpenChat: (target?: ChatTarget) => void;
  assistantName?: string;
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("for-you");
  const [items, setItems] = useState<ScratchpadItem[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RunActivityRow[]>([]);
  const [memory, setMemory] = useState<MemoryDocument[]>([]);
  const [drafts, setDrafts] = useState({ goals: "", ideas: "" });
  const [editing, setEditing] = useState<MemoryDocument | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Source, boolean>>>({});
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const hierarchyKey = botIds.join("|");

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const current = ++generation.current;
    const ids = [...new Set([botId, ...hierarchyKey.split("|").filter(Boolean)])];
    const options = { signal: pending.signal };
    setRefreshing(true);
    const result = await Promise.allSettled([
      Promise.all(ids.map((id) => rpc.scratchpad.list({ botId: id, includeDone: true }, options))),
      Promise.all(ids.map((id) => rpc.routines.list({ botId: id }, options))),
      Promise.all([rpc.runs.list({ filter: "active" }, options), rpc.runs.list({ filter: "recent" }, options)]),
      Promise.all([rpc.memory.list({ scope: "user" }, options), rpc.memory.list({ botId }, options)]),
    ] as const);
    if (pending.signal.aborted || generation.current !== current) return;
    const nextErrors: Partial<Record<Source, boolean>> = {};
    if (result[0].status === "fulfilled") setItems(result[0].value.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    else nextErrors.items = true;
    if (result[1].status === "fulfilled") setRoutines(result[1].value.flat());
    else nextErrors.routines = true;
    if (result[2].status === "fulfilled") {
      const idsSet = new Set(ids);
      const byId = new Map<string, RunActivityRow>();
      [...result[2].value[0].runs, ...result[2].value[1].runs].forEach((run) => {
        if (idsSet.has(run.botId)) byId.set(run.runId, run);
      });
      setRuns([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } else nextErrors.runs = true;
    if (result[3].status === "fulfilled") {
      const byId = new Map<string, MemoryDocument>();
      result[3].value.flat().forEach((doc) => byId.set(doc.id, doc));
      setMemory([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } else nextErrors.memory = true;
    setErrors(nextErrors);
    setLoading(false);
    setRefreshing(false);
  }, [botId, hierarchyKey]);

  useEffect(() => {
    void refresh();
    return () => { controller.current?.abort(); generation.current += 1; };
  }, [refresh]);

  const openChat = useCallback((target?: ChatTarget) => {
    onOpenChat(target ?? { botId });
    onClose();
  }, [botId, onClose, onOpenChat]);
  const openRun = (run: RunActivityRow) => openChat({ botId: run.botId, ...(run.groupId ? { groupId: run.groupId } : {}) });

  async function createItem(kind: "goals" | "ideas") {
    const title = drafts[kind].trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const item = await rpc.scratchpad.create({ botId, title, status: kind === "ideas" ? "parked" : "open", notes: "" });
      setItems((current) => [item, ...current]);
      setDrafts((current) => ({ ...current, [kind]: "" }));
      setErrors((current) => ({ ...current, items: false }));
    } catch { setErrors((current) => ({ ...current, items: true })); }
    finally { setBusy(false); }
  }
  async function changeStatus(item: ScratchpadItem, status: ScratchpadItem["status"]) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await rpc.scratchpad.update({ itemId: item.id, status });
      setItems((current) => current.map((entry) => entry.id === item.id ? next : entry));
      setErrors((current) => ({ ...current, items: false }));
    } catch { setErrors((current) => ({ ...current, items: true })); }
    finally { setBusy(false); }
  }
  async function saveMemory() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const next = await rpc.memory.update({ documentId: editing.id, content: memoryDraft });
      setMemory((current) => current.map((doc) => doc.id === editing.id ? next : doc));
      setEditing(null);
      setErrors((current) => ({ ...current, memory: false }));
    } catch { setErrors((current) => ({ ...current, memory: true })); }
    finally { setBusy(false); }
  }

  const needsAttention = useMemo(() => runs.filter(waiting), [runs]);
  const inMotion = useMemo(() => runs.filter(working), [runs]);
  const recent = useMemo(() => runs.filter((run) => !waiting(run) && !working(run)), [runs]);
  const goals = useMemo(() => items.filter((item) => item.status === "open"), [items]);
  const ideas = useMemo(() => items.filter((item) => item.status === "parked"), [items]);
  const activeRoutines = useMemo(() => routines.filter((routine) => routine.active), [routines]);
  const firstMemory = memory[0];
  const issueCount = Object.values(errors).filter(Boolean).length;

  const runCard = (run: RunActivityRow) => (
    <button className="rk-pw-card rk-pw-run" type="button" key={run.runId} onClick={() => openRun(run)}>
      <span className="rk-pw-mark"><Clock3 size={18} /></span>
      <span className="rk-pw-copy"><strong>{run.promptSnippet || run.botName}</strong><small>{statusLabel(run.status)} · {run.botName} · {dateLabel(run.updatedAt)}</small></span>
      <ChevronRight size={17} />
    </button>
  );
  const goalCard = (item: ScratchpadItem) => (
    <article className="rk-pw-card rk-pw-item" key={item.id}>
      <button className="rk-pw-check" type="button" disabled={busy} aria-label={`Complete ${item.title}`} onClick={() => void changeStatus(item, "done")}><Check size={14} /></button>
      <span className="rk-pw-copy"><strong>{item.title}</strong>{item.notes ? <small>{item.notes}</small> : null}</span>
      <button className="rk-pw-link" type="button" onClick={() => openChat({ botId, draft: `Let's talk about my goal: ${item.title}` })}>Discuss <ArrowRight size={14} /></button>
    </article>
  );
  const ideaCard = (item: ScratchpadItem) => (
    <article className="rk-pw-card rk-pw-item" key={item.id}>
      <span className="rk-pw-mark"><Lightbulb size={17} /></span>
      <span className="rk-pw-copy"><strong>{item.title}</strong>{item.notes ? <small>{item.notes}</small> : null}</span>
      <span className="rk-pw-item-actions"><button className="rk-pw-link" type="button" disabled={busy} onClick={() => void changeStatus(item, "open")}>Make goal</button><button className="rk-pw-link" type="button" onClick={() => openChat({ botId, draft: `Let's explore this idea: ${item.title}` })}>Discuss <ArrowRight size={14} /></button></span>
    </article>
  );
  const routineCard = (routine: Routine) => (
    <div className="rk-pw-card rk-pw-item" key={routine.id}>
      <span className="rk-pw-mark"><Clock3 size={17} /></span>
      <span className="rk-pw-copy"><strong>{routine.name}</strong><small>{routine.nextRunAt ? `Next check ${dateLabel(routine.nextRunAt)}` : "Active"}</small></span>
    </div>
  );

  return (
    <div className={`rk-personal-workspace rk-personal-v2 ${embedded ? "rk-pw-embedded" : "rk-pw-overlay"}`} {...(!embedded ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Personal workspace" } : {})}>
      <div className="rk-pw-scroll"><div className="rk-pw-inner">
        <header className="rk-pw-top"><div className="rk-pw-brand"><Sparkles size={18} /> PERSONAL SPACE</div><div className="rk-pw-top-actions"><button type="button" aria-label="Refresh personal space" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={17} /></button>{!embedded ? <><button className="rk-pw-conversation" type="button" onClick={() => openChat()}><MessageCircle size={16} /> Conversation</button><button type="button" aria-label="Close personal space" onClick={onClose}><X size={18} /></button></> : null}</div></header>
        <div className="rk-pw-intro"><div><p>WITH {assistantName.toUpperCase()}</p><h1>{tab === "for-you" ? "Your day, together." : tabs.find((entry) => entry.id === tab)?.label}</h1><span>{tab === "for-you" ? "What matters, what's moving, and where you can step in." : "Your work with Negroni, in one place."}</span></div><div className="rk-pw-presence"><i />{needsAttention.length ? `${needsAttention.length} need your attention` : inMotion.length ? `${assistantName} is working` : "Ready when you are"}</div></div>
        <nav className="rk-pw-tabs" role="tablist" aria-label="Personal space sections">{tabs.map((entry) => <button type="button" role="tab" aria-selected={tab === entry.id} aria-controls="rk-pw-panel" key={entry.id} onClick={() => { setTab(entry.id); setEditing(null); }}>{entry.label}</button>)}</nav>
        {issueCount ? <div className="rk-pw-error" role="status"><span>Some information couldn't refresh. Your other data is still here.</span><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
        <div id="rk-pw-panel" className="rk-pw-content" role="tabpanel">
          {loading ? <div className="rk-pw-loading" aria-label="Loading personal space"><span /><span /><span /></div> : null}
          {!loading && tab === "for-you" ? <>
            {needsAttention.length ? <Section title="Needs your attention" icon={<Clock3 size={18} />} count={needsAttention.length}>{needsAttention.slice(0, 3).map(runCard)}</Section> : null}
            {inMotion.length ? <Section title="In motion" icon={<Sparkles size={18} />} count={inMotion.length}>{inMotion.slice(0, 3).map(runCard)}</Section> : null}
            <Section title="Your goals" icon={<Sparkles size={18} />} count={goals.length} action="See all" onAction={() => setTab("goals")}>{goals.length ? goals.slice(0, 3).map(goalCard) : <Empty title="Start with something you care about" text={`Tell ${assistantName} what you'd like to work toward.`} action="Talk about a goal" onAction={() => openChat({ botId, draft: "I'd like to set a goal: " })} />}</Section>
            {activeRoutines.length ? <Section title="Keeping track" icon={<Clock3 size={18} />} count={activeRoutines.length}>{activeRoutines.slice(0, 3).map(routineCard)}</Section> : null}
            {recent.length ? <Section title="Recently" icon={<Clock3 size={18} />} action="All activity" onAction={() => setTab("activity")}>{recent.slice(0, 3).map(runCard)}</Section> : null}
            {ideas.length ? <Section title="Ideas to explore" icon={<Lightbulb size={18} />} count={ideas.length} action="See all" onAction={() => setTab("ideas")}>{ideas.slice(0, 2).map(ideaCard)}</Section> : null}
            {firstMemory ? <Section title="What I remember" icon={<Sparkles size={18} />} action="View memory" onAction={() => setTab("memory")}><button className="rk-pw-card rk-pw-run" type="button" onClick={() => { setTab("memory"); setEditing(firstMemory); setMemoryDraft(firstMemory.content); }}><span className="rk-pw-copy"><strong>{memoryTitle(firstMemory)}</strong><small>{firstMemory.content}</small></span><ChevronRight size={17} /></button></Section> : null}
          </> : null}
          {!loading && tab === "goals" ? <><Section title="Goals in progress" icon={<Sparkles size={18} />} count={goals.length}>{goals.length ? goals.map(goalCard) : <Empty title="No goals yet" text="Add something you'd like to work toward." />}</Section><AddItem kind="goals" value={drafts.goals} disabled={busy} onChange={(value) => setDrafts((current) => ({ ...current, goals: value }))} onSubmit={() => void createItem("goals")} />{activeRoutines.length ? <Section title="Tracking" icon={<Clock3 size={18} />} count={activeRoutines.length}>{activeRoutines.map(routineCard)}</Section> : null}{items.some((item) => item.status === "done") ? <p className="rk-pw-completed">{items.filter((item) => item.status === "done").length} completed goals</p> : null}</> : null}
          {!loading && tab === "ideas" ? <><Section title="Ideas for later" icon={<Lightbulb size={18} />} count={ideas.length} description={`Possibilities you've saved with ${assistantName}.`}>{ideas.length ? ideas.map(ideaCard) : <Empty title="A place for possibilities" text="Save an idea and return to it when you're ready." />}</Section><AddItem kind="ideas" value={drafts.ideas} disabled={busy} onChange={(value) => setDrafts((current) => ({ ...current, ideas: value }))} onSubmit={() => void createItem("ideas")} /></> : null}
          {!loading && tab === "activity" ? <>{needsAttention.length ? <Section title="Needs your attention" icon={<Clock3 size={18} />} count={needsAttention.length}>{needsAttention.map(runCard)}</Section> : null}{inMotion.length ? <Section title="In motion" icon={<Sparkles size={18} />} count={inMotion.length}>{inMotion.map(runCard)}</Section> : null}<Section title="Recent activity" icon={<Clock3 size={18} />} count={recent.length}>{recent.length ? recent.map(runCard) : <Empty title="No recent work yet" text="Work Negroni starts will appear here." />}</Section></> : null}
          {!loading && tab === "memory" ? <><Section title="What Negroni remembers" icon={<Sparkles size={18} />} count={memory.length} description="Open an entry to read or change it.">{memory.length ? memory.map((doc) => <button className="rk-pw-card rk-pw-memory-row" type="button" key={doc.id} onClick={() => { setEditing(doc); setMemoryDraft(doc.content); }}><small>{doc.scope === "user" ? "About you" : assistantName}</small><strong>{memoryTitle(doc)}</strong><span>{doc.content}</span><ChevronRight size={17} /></button>) : <Empty title="No memories saved yet" text={`Ask ${assistantName} to remember something important.`} />}</Section>{editing ? <div className="rk-pw-editor"><div><strong>Edit memory</strong><button type="button" aria-label="Close memory editor" onClick={() => setEditing(null)}><X size={17} /></button></div><textarea aria-label="Memory content" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} /><footer><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="button" disabled={busy} onClick={() => void saveMemory()}>Save changes</button></footer></div> : null}</> : null}
        </div>
      </div></div>
      <footer className="rk-pw-footer"><button type="button" onClick={() => openChat()}><MessageCircle size={18} /><span>Ask {assistantName}</span><ArrowRight size={17} /></button></footer>
    </div>
  );
}

function Section({ title, icon, count, action, onAction, description, children }: { title: string; icon: ReactNode; count?: number; action?: string; onAction?: () => void; description?: string; children: ReactNode }) {
  return <section className="rk-pw-section"><div className="rk-pw-section-heading"><div><span className="rk-pw-section-icon">{icon}</span><h2>{title}</h2>{count !== undefined ? <small>{count}</small> : null}</div>{action ? <button type="button" onClick={onAction}>{action} <ArrowRight size={14} /></button> : null}</div>{description ? <p className="rk-pw-description">{description}</p> : null}<div className="rk-pw-stack">{children}</div></section>;
}
function Empty({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="rk-pw-card rk-pw-empty"><Sparkles size={18} /><strong>{title}</strong><p>{text}</p>{action ? <button type="button" onClick={onAction}>{action} <ArrowRight size={14} /></button> : null}</div>;
}
function AddItem({ kind, value, disabled, onChange, onSubmit }: { kind: "goals" | "ideas"; value: string; disabled: boolean; onChange: (value: string) => void; onSubmit: () => void }) {
  return <form className="rk-pw-add" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><input aria-label={kind === "goals" ? "New goal" : "New idea"} placeholder={kind === "goals" ? "Add a goal" : "Save an idea"} value={value} onChange={(event) => onChange(event.target.value)} /><button type="submit" disabled={!value.trim() || disabled} aria-label={kind === "goals" ? "Add goal" : "Save idea"}><ArrowRight size={17} /></button></form>;
}
