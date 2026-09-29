import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelRoute, ModelRouting } from "@rakazo/contracts";
import { emptyModelRouting, modelRouteKey } from "@rakazo/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { rpc } from "../lib/rpc";

export function ModelRoutingPanel({
  catalog,
  connectedProviders,
  selected,
}: {
  catalog: ModelCatalogEntry[];
  connectedProviders: string[];
  selected?: ModelRoute;
}) {
  const { t } = useLingui();
  const [routing, setRouting] = useState<ModelRouting>(emptyModelRouting);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    void rpc.models
      .routing()
      .then((value) => {
        if (live) {
          setRouting(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (live) setError(t`Could not load model routing`);
      });
    return () => {
      live = false;
    };
  }, []);
  const label = (route: ModelRoute) => {
    const entry = catalog.find((m) => m.provider === route.provider && m.id === route.modelId);
    return `${entry?.label ?? route.modelId} · ${entry?.providerName ?? route.provider}`;
  };
  function edit(value: ModelRouting) {
    setRouting(value);
    setSaved(false);
  }
  function remove(route: ModelRoute) {
    const key = modelRouteKey(route);
    edit({
      enabled: routing.enabled.filter((m) => modelRouteKey(m) !== key),
      conversation:
        routing.conversation && modelRouteKey(routing.conversation) !== key
          ? routing.conversation
          : null,
      task: routing.task && modelRouteKey(routing.task) !== key ? routing.task : null,
      router: routing.router && modelRouteKey(routing.router) !== key ? routing.router : null,
    });
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      setRouting(await rpc.models.saveRouting(routing));
      setSaved(true);
      window.dispatchEvent(new Event("negroni-models-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Could not save models`);
    } finally {
      setBusy(false);
    }
  }
  const canAdd =
    selected &&
    connectedProviders.includes(selected.provider) &&
    !routing.enabled.some((m) => modelRouteKey(m) === modelRouteKey(selected));
  return (
    <section
      aria-label={t`Enabled models`}
      className="rounded-xl border border-border p-4 space-y-3"
    >
      <h3 className="text-sm font-medium">
        <Trans>Enabled models</Trans>
      </h3>
      <Input
        aria-label={t`Find model`}
        placeholder={t`Find model`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <NativeSelect
        aria-label={t`Add model`}
        value=""
        disabled={busy || !loaded}
        onChange={(e) => {
          const entry = catalog.find(
            (m) => modelRouteKey({ provider: m.provider, modelId: m.id }) === e.target.value,
          );
          if (entry)
            edit({
              ...routing,
              enabled: [...routing.enabled, { provider: entry.provider, modelId: entry.id }],
            });
        }}
      >
        <NativeSelectOption value="">{t`Add model…`}</NativeSelectOption>
        {catalog
          .filter(
            (m) =>
              connectedProviders.includes(m.provider) &&
              !routing.enabled.some(
                (r) => modelRouteKey(r) === modelRouteKey({ provider: m.provider, modelId: m.id }),
              ) &&
              `${m.label} ${m.id} ${m.provider}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((m) => (
            <NativeSelectOption
              key={modelRouteKey({ provider: m.provider, modelId: m.id })}
              value={modelRouteKey({ provider: m.provider, modelId: m.id })}
            >
              {m.label} · {m.providerName ?? m.provider}
            </NativeSelectOption>
          ))}
      </NativeSelect>
      <div className="flex flex-wrap gap-2">
        {routing.enabled.map((route) => (
          <button
            key={modelRouteKey(route)}
            type="button"
            disabled={busy || !loaded}
            onClick={() => remove(route)}
            aria-label={t`Remove ${label(route)}`}
            className="rounded-full bg-muted px-3 py-1 text-xs"
          >
            {label(route)} ×
          </button>
        ))}
        {canAdd && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !loaded}
            onClick={() => edit({ ...routing, enabled: [...routing.enabled, selected] })}
          >
            <Trans>Add selected model</Trans>
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["conversation", t`Default chat`],
            ["task", t`Complex tasks`],
            ["router", t`Auto router`],
          ] as const
        ).map(([role, title]) => (
          <label
            key={role}
            htmlFor={`model-route-${role}`}
            className="text-xs text-muted-foreground"
          >
            {title}
            <NativeSelect
              aria-label={title}
              disabled={busy || !loaded}
              value={routing[role] ? modelRouteKey(routing[role]) : ""}
              onChange={(e) =>
                edit({
                  ...routing,
                  [role]: routing.enabled.find((m) => modelRouteKey(m) === e.target.value) ?? null,
                })
              }
            >
              <NativeSelectOption value="">
                {role === "router" ? t`Use default profiles` : t`Workspace default`}
              </NativeSelectOption>
              {routing.enabled.map((route) => (
                <NativeSelectOption key={modelRouteKey(route)} value={modelRouteKey(route)}>
                  {label(route)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button size="sm" onClick={() => void save()} disabled={busy || !loaded}>
        {saved ? t`Saved` : t`Save models`}
      </Button>
    </section>
  );
}
