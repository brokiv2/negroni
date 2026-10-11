import { ResponseUiBlock } from "@rakazo/contracts";
import { RESPONSE_UI_FIXTURE } from "@rakazo/contracts/response-ui-fixture";
import { createResponseUiStateSession } from "@rakazo/core";
import { ResponseUiView } from "@rakazo/ui-web";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const initial = RESPONSE_UI_FIXTURE;
const storageKey = "response-ui-demo";
async function loadImage(artifactId: string) {
  if (artifactId !== "fixture-image") return null;
  const response = await fetch(new URL("./response-ui.png", import.meta.url));
  return response.ok ? response.blob() : null;
}
function storedBlock() {
  try {
    return ResponseUiBlock.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return initial;
  }
}
function Fixture() {
  const [block, setBlock] = useState(storedBlock);
  const [draft, setDraft] = useState("");
  const [session] = useState(() =>
    createResponseUiStateSession(block, async ({ revision, state }) => {
      const next = ResponseUiBlock.parse({ ...initial, revision: revision + 1, state });
      localStorage.setItem(storageKey, JSON.stringify(next));
      setBlock(next);
      return next;
    }),
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    session.receive(block);
  }, [block, session]);
  useEffect(() => () => session.close(), [session]);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <p className="text-xs text-muted-foreground">
        Interactive response fixture · sample data · local persistence
      </p>
      <ResponseUiView
        block={block}
        loadImage={loadImage}
        state={snapshot.state}
        onStateChange={session.change}
        onFollowUp={setDraft}
        dataLabel="View data"
      />
      <label className="flex flex-col gap-2 text-sm">
        Message
        <textarea
          aria-label="Message"
          className="rounded-lg border border-input bg-background p-3"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <output data-testid="saved-revision" className="sr-only">
        {block.revision}
      </output>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
