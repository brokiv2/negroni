import { t } from "@lingui/core/macro";
import { ResponseUiBlock } from "@rakazo/contracts";
import { createResponseUiStateSession, ResponseUiSaveConflict } from "@rakazo/core";
import { Button, ResponseUiView } from "@rakazo/ui-web";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { rpc } from "../lib/rpc";

export function ResponseUiMessage({
  messageId,
  block,
  target,
  onFollowUp,
}: {
  messageId: string;
  block: ResponseUiBlock;
  target: ArtifactTarget;
  onFollowUp: (text: string) => void;
}) {
  const [session] = useState(() =>
    createResponseUiStateSession(block, async (attempt) => {
      try {
        return await rpc.threads.responseUiState({ messageId, blockId: block.id, ...attempt });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "CONFLICT")
          throw new ResponseUiSaveConflict();
        throw error;
      }
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    session.receive(block);
  }, [block, session]);
  useEffect(() => () => session.close(), [session]);
  const live = messageId.startsWith("progress:");
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const page = await rpc.threads.messages({ ...target, around: { messageId } });
      const value = page.messages
        .find((m) => m.id === messageId)
        ?.blocks.find((b) => b.kind === "response_ui" && b.id === block.id);
      const parsed = ResponseUiBlock.safeParse(value);
      if (parsed.success) {
        session.reload(parsed.data);
        setReload((n) => n + 1);
      }
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <fieldset
      aria-label={block.summary}
      className="m-0 w-[36rem] min-w-0 max-w-full border-0 p-0"
      onBlur={() => {
        void session.flush();
      }}
    >
      <ResponseUiView
        key={reload}
        block={block}
        state={state.state}
        disabled={live}
        onStateChange={session.change}
        onFollowUp={async (text) => {
          await session.flush();
          const current = session.getSnapshot();
          if (!current.error && !current.dirty) onFollowUp(text);
        }}
        dataLabel={t`View data`}
      />
      {state.error ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
          <span className="text-destructive">
            {state.error === "conflict"
              ? t`Changed on another device. Your edits are unsaved.`
              : t`Couldn’t save these values.`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={refreshing || state.saving}
            onClick={() => {
              if (state.error === "conflict") void refresh().catch(() => undefined);
              else void session.retry();
            }}
          >
            {state.error === "conflict" ? t`Refresh values` : t`Retry`}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
