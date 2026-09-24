import type { Bot, ComputerStatus, Me, ThinkingLevel } from "@rakazo/contracts";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  type ComputerMode,
  normalizeCreateBotProfile,
} from "@rakazo/contracts";
import { connectedModelOptions, modelOptionKey, parseModelOptionKey } from "@rakazo/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { ComputerMaintenanceActions } from "../components/computer-maintenance-actions";
import { ComputerModePicker } from "../components/computer-mode-picker";
import { type MobileBot, type MobileModel, type MobileModelCredential, rpc } from "../lib/api";
import { native, useResolvedAppearance } from "../lib/native";

type BotSettingsRecord = MobileBot &
  Pick<Bot, "modelProvider" | "modelId"> & {
    description?: string;
  };

export default function BotSettingsScreen() {
  const router = useRouter();
  useResolvedAppearance();
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const [bot, setBot] = useState<BotSettingsRecord | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [computerMode, setComputerMode] = useState<ComputerMode>("team");
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [modelKey, setModelKey] = useState("");
  const [catalog, setCatalog] = useState<MobileModel[]>([]);
  const [credentials, setCredentials] = useState<MobileModelCredential[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelLoadError, setModelLoadError] = useState(false);
  const connectedOptions = connectedModelOptions(credentials, catalog);
  const selectedModel = connectedOptions.find((entry) => entry.key === modelKey);
  const modelLabel = modelKey
    ? (selectedModel?.label ?? parseModelOptionKey(modelKey)?.modelId ?? modelKey)
    : `Space default${defaultModel ? ` (${defaultModel})` : ""}`;

  useEffect(() => {
    if (!botId) return;
    void Promise.all([
      rpc<BotSettingsRecord>("bots/get", { botId }),
      rpc<ComputerStatus>("computer/status", { botId }).catch(() => null),
    ])
      .then(([next, status]) => {
        setBot(next);
        setModelKey(
          next.modelProvider && next.modelId
            ? modelOptionKey(next.modelProvider, next.modelId)
            : "",
        );
        setName(next.name);
        setTitle(next.title);
        setDescription(next.description ?? "");
        setComputerMode(next.computerMode);
        setComputer(status);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load bot"));
  }, [botId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      rpc<MobileModel[]>("models/list"),
      rpc<MobileModelCredential[]>("models/credentials"),
      rpc<Me>("me"),
    ])
      .then(([nextCatalog, nextCredentials, me]) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        setCredentials(nextCredentials);
        setDefaultModel(me.defaultModel);
      })
      .catch(() => {
        if (!cancelled) setModelLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!botId || !bot || pending) return;
    setPending(true);
    setError(null);
    try {
      const profile = normalizeCreateBotProfile({ name, title, description });
      const input: {
        botId: string;
        name?: string;
        title?: string;
        description?: string;
        instructions?: string;
        modelProvider?: string | null;
        modelId?: string | null;
        thinkingLevel?: ThinkingLevel | null;
      } = { botId };
      if (profile.name !== bot.name) input.name = profile.name;
      if (profile.title !== bot.title) input.title = profile.title;
      if (profile.description !== (bot.description ?? "")) {
        input.description = profile.description;
        // Keep instructions in sync with description (same as web BotSettings).
        input.instructions = profile.instructions;
      }
      const storedModelKey =
        bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "";
      if (modelKey !== storedModelKey) {
        const selection = parseModelOptionKey(modelKey);
        input.modelProvider = selection?.provider ?? null;
        input.modelId = selection?.modelId ?? null;
        // A reasoning override from the previous model may not be supported.
        input.thinkingLevel = null;
      }
      if (computerMode !== bot.computerMode) {
        await rpc("bots/setComputer", { botId, mode: computerMode });
      }
      // Use key presence so clearing title/description to "" still persists.
      if (Object.keys(input).length > 1) {
        await rpc("bots/update", input);
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bot");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Chat settings" }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: "#050506" }}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={{ color: "#85858A", fontSize: 14 }}>Name</Text>
        <TextInput
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          onChangeText={setName}
          placeholder="Name this bot"
          placeholderTextColor="#6C6C70"
          style={{
            marginTop: 8,
            backgroundColor: "#1A1A1D",
            borderRadius: 11,
            padding: 16,
            color: "#ECECEE",
          }}
        />
        <Text style={{ color: "#85858A", marginTop: 16, fontSize: 14 }}>Title</Text>
        <TextInput
          value={title}
          maxLength={BOT_TITLE_MAX_LENGTH}
          onChangeText={setTitle}
          placeholder="Describe what this bot does"
          placeholderTextColor="#6C6C70"
          style={{
            marginTop: 8,
            backgroundColor: "#1A1A1D",
            borderRadius: 11,
            padding: 16,
            color: "#ECECEE",
          }}
        />
        <Text style={{ color: "#85858A", marginTop: 16, fontSize: 14 }}>Description</Text>
        <TextInput
          value={description}
          maxLength={BOT_DESCRIPTION_MAX_LENGTH}
          onChangeText={setDescription}
          placeholder="What this bot is for"
          placeholderTextColor="#6C6C70"
          multiline
          style={{
            marginTop: 8,
            backgroundColor: "#1A1A1D",
            borderRadius: 11,
            padding: 16,
            color: "#ECECEE",
            minHeight: 120,
            textAlignVertical: "top",
          }}
        />
        <Text style={{ color: native.secondaryLabel, marginTop: 20, fontSize: 14 }}>Model</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Model: ${modelLabel}`}
          accessibilityState={{ expanded: modelPickerOpen }}
          onPress={() => setModelPickerOpen((value) => !value)}
          disabled={pending || !bot}
          style={{ marginTop: 8, padding: 16, borderRadius: 14, backgroundColor: native.fill }}
        >
          <Text style={{ color: native.label, fontSize: 16 }}>{modelLabel}</Text>
        </Pressable>
        {modelPickerOpen ? (
          <>
            {[
              { key: "", label: `Space default${defaultModel ? ` (${defaultModel})` : ""}` },
              ...connectedOptions,
            ].map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: option.key === modelKey }}
                disabled={pending}
                onPress={() => {
                  setModelKey(option.key);
                  setModelPickerOpen(false);
                }}
                style={{
                  marginTop: 4,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: option.key === modelKey ? native.fillPressed : native.fill,
                }}
              >
                <Text style={{ color: native.label, fontSize: 15 }}>{option.label}</Text>
              </Pressable>
            ))}
            {modelLoadError ? (
              <Text style={{ color: native.secondaryLabel, marginTop: 8 }}>
                Could not load connected models.
              </Text>
            ) : null}
          </>
        ) : null}
        <ComputerModePicker value={computerMode} onChange={setComputerMode} />
        <ComputerMaintenanceActions
          botId={botId}
          computer={computer}
          onChanged={async () => {
            const status = await rpc<ComputerStatus>("computer/status", { botId });
            setComputer(status);
          }}
        />
        {error ? <Text style={{ color: "#EF4444", marginTop: 16 }}>{error}</Text> : null}
        <Pressable
          onPress={() => void save()}
          disabled={!name.trim() || pending || !bot}
          style={{
            marginTop: 24,
            backgroundColor: "#F1F1EF",
            borderRadius: 11,
            padding: 16,
            alignItems: "center",
            opacity: !name.trim() || pending || !bot ? 0.4 : 1,
          }}
        >
          <Text style={{ color: "#17171A", fontSize: 16 }}>{pending ? "Saving…" : "Save"}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}
