import type { Bot, ModelRoute, ModelRouting } from "@rakazo/contracts";
import { emptyModelRouting, modelRouteKey } from "@rakazo/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type MobileModel, rpc } from "../lib/api";
import { t } from "../lib/i18n";
import { presentMessageActionSheet } from "../lib/message-action-sheet";
import { native, useResolvedAppearance } from "../lib/native";

function routeLabel(route: ModelRoute, catalog: MobileModel[]) {
  const m = catalog.find((m) => m.provider === route.provider && m.id === route.modelId);
  return `${m?.label ?? route.modelId} · ${m?.providerName ?? route.provider}`;
}
export function MobileModelRouting({
  catalog,
  selected,
  connected,
}: {
  catalog: MobileModel[];
  selected?: ModelRoute;
  connected: boolean;
}) {
  const [routing, setRouting] = useState<ModelRouting>(emptyModelRouting);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const colorScheme = useResolvedAppearance();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void rpc<ModelRouting>("models/routing")
        .then((r) => {
          if (live) {
            setRouting(r);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (live) setError(t("Could not load models"));
        });
      return () => {
        live = false;
      };
    }, []),
  );
  async function save(next: ModelRouting) {
    setBusy(true);
    setError("");
    try {
      setRouting(await rpc<ModelRouting>("models/saveRouting", next));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not save models"));
    } finally {
      setBusy(false);
    }
  }
  const button = (label: string, action: () => void, key = label) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      disabled={busy || !loaded}
      onPress={action}
      style={{ paddingVertical: 12 }}
    >
      <Text style={{ color: native.label }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ borderRadius: 16, padding: 16, backgroundColor: native.fill }}>
      <Text style={{ color: native.label, fontWeight: "600" }}>{t("Enabled models")}</Text>
      {routing.enabled.map((route) =>
        button(
          `${routeLabel(route, catalog)} ×`,
          () => {
            const key = modelRouteKey(route);
            void save({
              enabled: routing.enabled.filter((r) => modelRouteKey(r) !== key),
              ...Object.fromEntries(
                (["conversation", "task", "router"] as const).map((role) => [
                  role,
                  routing[role] && modelRouteKey(routing[role]!) !== key ? routing[role] : null,
                ]),
              ),
            } as ModelRouting);
          },
          modelRouteKey(route),
        ),
      )}
      {selected &&
        connected &&
        !routing.enabled.some((r) => modelRouteKey(r) === modelRouteKey(selected)) &&
        button(
          t("Add selected model"),
          () => void save({ ...routing, enabled: [...routing.enabled, selected] }),
        )}
      {(
        [
          ["conversation", t("Default chat")],
          ["task", t("Complex tasks")],
          ["router", t("Auto router")],
        ] as const
      ).map(([role, title]) =>
        button(
          `${title}: ${routing[role] ? routeLabel(routing[role]!, catalog) : t("Workspace default")}`,
          () =>
            presentMessageActionSheet({
              title,
              colorScheme,
              cancel: t("Cancel"),
              more: t("More"),
              actions: [
                {
                  text: role === "router" ? t("Use default profiles") : t("Workspace default"),
                  onPress: () => void save({ ...routing, [role]: null }),
                },
                ...routing.enabled.map((r) => ({
                  text: routeLabel(r, catalog),
                  onPress: () => void save({ ...routing, [role]: r }),
                })),
              ],
            }),
          role,
        ),
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: native.label }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function MobileChatModelPicker({ botId, disabled }: { botId: string; disabled?: boolean }) {
  const router = useRouter();
  const colorScheme = useResolvedAppearance();
  const [selected, setSelected] = useState<ModelRoute | null>(null);
  const [catalog, setCatalog] = useState<MobileModel[]>([]);
  const [routing, setRouting] = useState<ModelRouting>(emptyModelRouting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void Promise.all([
        rpc<Bot>("bots/get", { botId }),
        rpc<ModelRouting>("models/routing"),
        rpc<MobileModel[]>("models/list"),
      ])
        .then(([bot, routes, models]) => {
          if (!live) return;
          setSelected(
            bot.modelProvider && bot.modelId
              ? { provider: bot.modelProvider, modelId: bot.modelId }
              : null,
          );
          setRouting(routes);
          setCatalog(models);
        })
        .catch(() => {
          if (live) setError(t("Could not load models"));
        });
      return () => {
        live = false;
      };
    }, [botId]),
  );
  async function choose(route: ModelRoute | null) {
    setBusy(true);
    setError("");
    try {
      await rpc("bots/update", {
        botId,
        modelProvider: route?.provider ?? null,
        modelId: route?.modelId ?? null,
      });
      setSelected(route);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not change model"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Chat model")}
        disabled={disabled || busy}
        onPress={() =>
          presentMessageActionSheet({
            title: t("Chat model"),
            colorScheme,
            cancel: t("Cancel"),
            more: t("More"),
            actions: [
              { text: t("Auto"), onPress: () => void choose(null) },
              ...routing.enabled.map((r) => ({
                text: routeLabel(r, catalog),
                onPress: () => void choose(r),
              })),
              { text: t("Manage models…"), onPress: () => router.push("/models") },
            ],
          })
        }
      >
        <Text style={{ color: native.secondaryLabel, fontSize: 12 }}>
          {selected ? routeLabel(selected, catalog) : t("Auto")} ⌄
        </Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
