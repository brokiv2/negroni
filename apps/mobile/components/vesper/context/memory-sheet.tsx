import type { MemoryDocument } from "@rakazo/contracts";
import { useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  appendMemoryLine,
  memoryDocumentTitle,
  memoryScopeLabel,
} from "../../../lib/vesper/memory";
import { Button, ErrorNotice, Field, Sheet } from "../kit";
import { s } from "../theme";

/**
 * Edit one memory document.
 *
 * Negroni's memory has no atomic rows, so this is a whole-document editor over
 * `memory.update` — the same revision path the rest of the app uses. Adding a
 * fact appends a bullet to the document rather than creating a row, and the
 * revision the server returns is what the caller keeps.
 */
export function MemorySheet({
  document,
  onClose,
  onSaved,
}: {
  document: MemoryDocument;
  onClose: () => void;
  onSaved: (document: MemoryDocument) => void;
}) {
  const [content, setContent] = useState(document.content);
  const [addition, setAddition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = content !== document.content;

  const save = (next: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void rpc<MemoryDocument>("memory/update", { documentId: document.id, content: next })
      .then(onSaved)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet
      title={memoryDocumentTitle(document)}
      subtitle={t("{scope} · revision {revision}", {
        scope: memoryScopeLabel(document.scope),
        revision: document.revision,
      })}
      onClose={onClose}
      wide
    >
      <Field
        label={t("What Vesper remembers")}
        value={content}
        onChangeText={setContent}
        multiline
        style={{ minHeight: 220 }}
      />
      <Field
        label={t("Add something")}
        value={addition}
        onChangeText={setAddition}
        placeholder={t("I prefer morning meetings")}
      />
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          primary
          small
          busy={busy}
          disabled={!addition.trim()}
          onPress={() => {
            save(appendMemoryLine(content, addition));
            setAddition("");
          }}
        >
          {t("Remember this")}
        </Button>
        <Button small busy={busy} disabled={!dirty} onPress={() => save(content)}>
          {t("Save changes")}
        </Button>
      </View>
      <Text style={[s.small, { marginTop: 16 }]}>
        {t("This is one document, not a list of facts. Saving writes a new revision of all of it.")}
      </Text>
    </Sheet>
  );
}
