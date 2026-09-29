import { useLingui } from "@lingui/react/macro";
import type { ModelRouting } from "@rakazo/contracts";
import { modelRouteKey } from "@rakazo/contracts";
import { NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { ModelCatalogEntry } from "../../lib/model-auth";
import { rpc } from "../../lib/rpc";

export function ChatModelPicker({
  botId,
  disabled,
  onSettings,
}: {
  botId: string;
  disabled?: boolean;
  onSettings: () => void;
}) {
  const { t } = useLingui();
  const [routing, setRouting] = useState<ModelRouting | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      Promise.all([rpc.models.routing(), rpc.models.list(), rpc.bots.get({ botId })])
        .then(([routes, models, bot]) => {
          if (!live) return;
          setRouting(routes);
          setCatalog(models);
          setValue(
            bot.modelProvider && bot.modelId
              ? modelRouteKey({ provider: bot.modelProvider, modelId: bot.modelId })
              : "",
          );
        })
        .catch(() => {
          if (live) setError(t`Could not load models`);
        });
    void refresh();
    window.addEventListener("negroni-models-changed", refresh);
    return () => {
      live = false;
      window.removeEventListener("negroni-models-changed", refresh);
    };
  }, [botId]);
  async function choose(next: string) {
    if (next === "settings") {
      onSettings();
      return;
    }
    const route = routing?.enabled.find((r) => modelRouteKey(r) === next);
    if (next && !route) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.bots.update({
        botId,
        modelProvider: route?.provider ?? null,
        modelId: route?.modelId ?? null,
      });
      setValue(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Could not change model`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-no-drag max-w-[260px]">
      <NativeSelect
        aria-label={t`Chat model`}
        value={value}
        disabled={disabled || busy || !routing}
        onChange={(e) => void choose(e.target.value)}
      >
        <NativeSelectOption value="">{t`Auto`}</NativeSelectOption>
        {value && !routing?.enabled.some((r) => modelRouteKey(r) === value) && (
          <NativeSelectOption value={value}>{JSON.parse(value).join(" · ")}</NativeSelectOption>
        )}
        {routing?.enabled.map((route) => {
          const entry = catalog.find(
            (m) => m.provider === route.provider && m.id === route.modelId,
          );
          return (
            <NativeSelectOption key={modelRouteKey(route)} value={modelRouteKey(route)}>
              {entry?.label ?? route.modelId} · {entry?.providerName ?? route.provider}
            </NativeSelectOption>
          );
        })}
        <NativeSelectOption value="settings">{t`Manage models…`}</NativeSelectOption>
      </NativeSelect>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
