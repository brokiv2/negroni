import { ChevronRight, File as FileIcon, Folder, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  breadcrumbs,
  COMPUTER_FILES_ROOT,
  type ComputerFileEntry,
  fileName,
  formatFileSize,
  isReadableFile,
  parentPath,
  previewContent,
  sortFileEntries,
} from "../../../lib/vesper/computer-files";
import { Button, Empty, ErrorNotice, Sheet } from "../kit";
import { colors, s, vt } from "../theme";

/**
 * The agent's workspace, read-only.
 *
 * `computer.files` and `computer.readFile` are the whole surface Negroni
 * exposes — there is no write, mkdir, import or exec RPC. Phase 9 adds those
 * behind `computer.exec`; until then this browses and reads, and says so.
 */
export function VesperWorkspaceFiles({ botId }: { botId: string | null }) {
  const [path, setPath] = useState<string>(COMPUTER_FILES_ROOT);
  const [entries, setEntries] = useState<ComputerFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ path: string; content: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(
    async (next: string, signal?: AbortSignal) => {
      if (!botId) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await rpc<ComputerFileEntry[]>(
          "computer/files",
          { botId, path: next },
          signal ? { signal } : undefined,
        );
        if (signal?.aborted) return;
        setEntries(sortFileEntries(rows));
      } catch (failure) {
        if (signal?.aborted) return;
        setError(failure instanceof Error ? failure.message : t("Could not list the workspace"));
        setEntries([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [botId],
  );

  useEffect(() => {
    const abort = new AbortController();
    void load(path, abort.signal);
    return () => abort.abort();
  }, [load, path]);

  const openFile = useCallback(
    async (entry: ComputerFileEntry) => {
      if (!botId) return;
      setOpening(entry.path);
      setError(null);
      try {
        const file = await rpc<{ path: string; content: string }>("computer/readFile", {
          botId,
          path: entry.path,
        });
        setOpen(file);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("Could not open the file"));
      } finally {
        setOpening(null);
      }
    },
    [botId],
  );

  const crumbs = breadcrumbs(path);
  const up = parentPath(path);
  const preview = open ? previewContent(open.content) : null;

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={[s.between, { gap: 10 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ alignItems: "center", gap: 3 }}
        >
          {crumbs.map((crumb, index) => (
            <View key={crumb.path} style={[s.row, { gap: 3 }]}>
              {index > 0 && <ChevronRight size={13} color={vt.extras.listChevron} />}
              <Pressable
                accessibilityRole="button"
                disabled={crumb.path === path}
                onPress={() => setPath(crumb.path)}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    s.small,
                    crumb.path === path && { color: colors.text, fontWeight: "600" },
                  ]}
                >
                  {crumb.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Refresh the workspace")}
          hitSlop={10}
          onPress={() => void load(path)}
          style={{ padding: 6 }}
        >
          <RefreshCw size={15} color={colors.muted} />
        </Pressable>
      </View>

      <ErrorNotice error={error} />

      {loading && entries.length === 0 ? (
        <View style={{ padding: 34, alignItems: "center" }}>
          <ActivityIndicator color={colors.blueDark} />
        </View>
      ) : entries.length === 0 && !error ? (
        <Empty
          icon={Folder}
          title={t("Nothing here")}
          detail={t("This folder on your agent’s computer is empty.")}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {up !== null && (
            <FileRow
              icon={Folder}
              title={t("Up one level")}
              detail={up}
              onPress={() => setPath(up)}
            />
          )}
          {entries.map((entry) => (
            <FileRow
              key={entry.path}
              icon={entry.kind === "dir" ? Folder : FileIcon}
              title={fileName(entry.path)}
              detail={
                entry.kind === "dir"
                  ? t("Folder")
                  : isReadableFile(entry.path)
                    ? formatFileSize(entry.size)
                    : t("{size} · cannot be shown here", { size: formatFileSize(entry.size) })
              }
              busy={opening === entry.path}
              disabled={entry.kind === "file" && !isReadableFile(entry.path)}
              onPress={() => (entry.kind === "dir" ? setPath(entry.path) : void openFile(entry))}
            />
          ))}
        </ScrollView>
      )}

      {!!open && !!preview && (
        <Sheet wide title={fileName(open.path)} subtitle={open.path} onClose={() => setOpen(null)}>
          {preview.truncated && (
            <Text style={[s.small, { marginBottom: 10 }]}>
              {t("Showing the first part of this file.")}
            </Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              selectable
              style={{
                fontFamily: "Menlo",
                fontSize: 12.5,
                lineHeight: 19,
                color: colors.text,
              }}
            >
              {preview.text}
            </Text>
          </ScrollView>
          <View style={{ marginTop: 18 }}>
            <Button onPress={() => setOpen(null)}>{t("Close")}</Button>
          </View>
        </Sheet>
      )}
    </View>
  );
}

function FileRow({
  icon: Icon,
  title,
  detail,
  onPress,
  busy,
  disabled,
}: {
  icon: typeof Folder;
  title: string;
  detail: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 11, gap: 13, borderRadius: 10, opacity: disabled ? 0.5 : 1 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { width: 34, height: 34, backgroundColor: colors.canvas }]}>
        <Icon size={16} color={colors.muted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={[s.text, { fontWeight: "500" }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={s.small}>
          {detail}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.blueDark} />
      ) : (
        !disabled && <ChevronRight size={15} color={vt.extras.listChevron} />
      )}
    </Pressable>
  );
}
