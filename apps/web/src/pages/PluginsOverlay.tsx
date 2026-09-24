import { Trans, useLingui } from "@lingui/react/macro";
import type { CapabilityInstall, Connection, ConnectionCatalogItem } from "@rakazo/contracts";
import {
  abortableDelay,
  buildConnectorCatalogView,
  EMPTY_PLUGIN_CATALOG_MESSAGE,
  POPULAR_CONNECTOR_SECTION_ID,
} from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

type SourceKind = "treg" | "mcp" | "api";

function itemKey(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
  return `${item.connectorId}:${item.slug}`;
}

function markConnected(
  items: ConnectionCatalogItem[],
  connectorId: string,
  slug: string,
  connected: boolean,
) {
  return items.map((entry) =>
    entry.connectorId === connectorId && entry.slug === slug ? { ...entry, connected } : entry,
  );
}

export function PluginsOverlay({
  onClose,
  onOpenMcp,
  activeBotId,
}: {
  onClose: () => void;
  onOpenMcp?: () => void;
  activeBotId?: string;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accountItem, setAccountItem] = useState<ConnectionCatalogItem | null>(null);
  const [accountLabel, setAccountLabel] = useState("");
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">("bearer");
  const [authName, setAuthName] = useState("x-api-key");
  const [pending, setPending] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const connectionAttempt = useRef<AbortController | null>(null);

  async function refresh() {
    const [items, installs, rows] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.capabilities.list(),
      rpc.connections.list().catch(() => [] as Connection[]),
    ]);
    setCatalog(items);
    setConnections(rows.filter((row) => row.status === "connected" || row.status === "pending"));
    setSources(installs.filter((install) => install.kind === "mcp" || install.kind === "api"));
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setCatalogError(err instanceof Error ? err.message : t`Could not load integrations`),
      )
      .finally(() => setLoading(false));
    return () => connectionAttempt.current?.abort();
  }, []);

  const searching = query.trim().length > 0;
  const view = useMemo(() => buildConnectorCatalogView(catalog, query), [catalog, query]);
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set([POPULAR_CONNECTOR_SECTION_ID]),
  );

  function toggleSection(id: string) {
    if (searching) return;
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function notifyAppConnected(item: ConnectionCatalogItem) {
    if (!activeBotId) return;
    await rpc.onboarding
      .appConnected({ botId: activeBotId, provider: item.slug })
      .catch(() => undefined);
  }

  function setItemConnected(item: ConnectionCatalogItem, connected: boolean) {
    setCatalog((prev) => markConnected(prev, item.connectorId, item.slug, connected));
  }

  function connectionsFor(item: ConnectionCatalogItem) {
    return connections.filter(
      (row) => row.connectorId === item.connectorId && row.provider === item.slug,
    );
  }

  function requestConnect(item: ConnectionCatalogItem) {
    const existing = connectionsFor(item);
    setAccountLabel(existing.length > 0 ? `${item.name} ${existing.length + 1}` : item.name);
    setAccountItem(item);
  }

  async function connect(item: ConnectionCatalogItem, label: string) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const displayName = label.trim() || item.name;
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName,
      });
      if (started.authorizationUrl)
        window.open(started.authorizationUrl, "rakazo-plugin-connect", "noopener,noreferrer");
      if (item.noAuth && !started.authorizationUrl) {
        if (controller.signal.aborted) return;
        setItemConnected(item, true);
        void notifyAppConnected(item);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          setItemConnected(item, true);
          await refresh();
          void notifyAppConnected(item);
          return;
        }
        await abortableDelay(2_000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setCatalogError(
        t`Connection to ${item.name} is still pending. You can close this and check again.`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setCatalogError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
      }
    }
  }

  async function revokeConnection(item: ConnectionCatalogItem, connectionId: string) {
    setCatalogError(null);
    const key = itemKey(item);
    setPending(`${key}:${connectionId}`);
    try {
      await rpc.connections.revoke({ connectionId });
      await refresh();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  function beginSource(kind: SourceKind) {
    setSourceKind(kind);
    setSourceError(null);
    setSourceName(kind === "treg" ? "Treg" : "");
    setSourceUrl(kind === "treg" ? "https://treg.to/mcp/" : "");
    setCredential("");
    setAuthType(kind === "treg" ? "bearer" : "none");
    setAuthName("x-api-key");
  }

  async function installSource() {
    if (!sourceKind) return;
    setSourceError(null);
    setPending("install-source");
    try {
      const auth = {
        type: authType,
        ...(authType === "header" ? { name: authName.trim() } : {}),
      };
      await rpc.capabilities.install({
        kind: sourceKind === "api" ? "api" : "mcp",
        name: sourceName.trim() || (sourceKind === "treg" ? "Treg" : "Custom connector"),
        source: sourceUrl.trim(),
        credential: credential.trim() || undefined,
        config:
          sourceKind === "treg"
            ? { preset: "treg", auth: { type: "bearer" } }
            : sourceKind === "api"
              ? { openApi: true, auth }
              : { preset: "custom", auth },
      });
      setCredential("");
      setSourceKind(null);
      await refresh();
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not install connector`);
    } finally {
      setPending(null);
    }
  }

  async function removeSource(install: CapabilityInstall) {
    setPending(install.id);
    setSourceError(null);
    try {
      await rpc.capabilities.remove({ id: install.id });
      setSources((current) => current.filter((source) => source.id !== install.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  function renderApp(item: ConnectionCatalogItem) {
    const key = itemKey(item);
    const accounts = item.connectionCount ?? connectionsFor(item).length;
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-[13px] px-2.5 py-2">
        <AppLogo name={item.name} logo={item.logo} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-[var(--rk-ink)]">{item.name}</div>
          {item.connected ? (
            <div className="truncate text-[12px] text-[var(--rk-muted-2)]">
              {accounts > 1 ? `${accounts} accounts` : "Connected"}
            </div>
          ) : pending === key ? (
            <div className="truncate text-[12px] text-[var(--rk-muted-2)]">
              <Trans>Waiting for authorization…</Trans>
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="pill"
          size="sm"
          disabled={pending === key || Boolean(pending?.startsWith(`${key}:`))}
          onClick={() => requestConnect(item)}
        >
          {pending === key ? "Adding…" : item.connected ? "Add account" : "Add"}
        </Button>
      </div>
    );
  }

  function renderAccounts(item: ConnectionCatalogItem) {
    const rows = connectionsFor(item);
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1 px-1 pb-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--rk-scroll)]/40 px-2 py-1.5 text-[12.5px]"
          >
            <span className="min-w-0 truncate text-[var(--rk-soft)]">
              {item.name}: {row.displayName}
              {row.status !== "connected" ? ` (${row.status})` : ""}
            </span>
            <Button
              type="button"
              variant="pill"
              size="sm"
              disabled={pending === `${itemKey(item)}:${row.id}`}
              onClick={() => void revokeConnection(item, row.id)}
            >
              {pending === `${itemKey(item)}:${row.id}` ? "Removing…" : "Remove"}
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-10">
      <div className="rk-dialog-surface flex h-[760px] max-h-[calc(100dvh-5rem)] w-[1080px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[var(--rk-hairline-strong)] bg-[var(--rk-surface)] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex shrink-0 items-start justify-between px-8 pt-7">
          <div className="text-2xl font-medium text-[var(--rk-ink-strong)]">
            <Trans>Integrations</Trans>
          </div>
          <button
            type="button"
            aria-label={t`Close integrations`}
            onClick={onClose}
            className="text-[var(--rk-muted)]"
          >
            ✕
          </button>
        </div>

        <div id="integration-list" className="rk-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-6">
          {view.connected.length > 0 ? (
            <section className="pt-4" data-testid="connected-integrations">
              <div className="mb-2 text-[13px] font-medium text-[var(--rk-muted)]">
                <Trans>Connected</Trans>
              </div>
              <div className="space-y-1">
                {view.connected.map((item) => (
                  <div key={itemKey(item)}>
                    {renderApp(item)}
                    {renderAccounts(item)}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="sticky top-0 z-10 bg-[var(--rk-surface)] pb-3 pt-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t`Search apps`}
              placeholder={t`Search apps`}
              className="w-full rounded-[13px] border border-[var(--rk-border)] bg-[var(--rk-inset)] px-4 py-3 text-[15px] text-[var(--rk-ink)] outline-none"
            />
            {accountItem ? (
              <form
                className="flex items-end gap-3 pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect(accountItem, accountLabel);
                  setAccountItem(null);
                }}
              >
                <label className="min-w-0 flex-1 text-[13px] text-[var(--rk-soft)]">
                  Account label
                  <input
                    value={accountLabel}
                    onChange={(event) => setAccountLabel(event.target.value)}
                    placeholder="Personal / Work"
                    className="mt-1 w-full rounded-[13px] border border-[var(--rk-border)] bg-[var(--rk-inset)] px-4 py-3 text-[15px] text-[var(--rk-ink)] outline-none"
                  />
                </label>
                <Button type="submit" variant="pill" disabled={pending !== null}>
                  Connect
                </Button>
                <Button type="button" variant="pill" onClick={() => setAccountItem(null)}>
                  Cancel
                </Button>
              </form>
            ) : null}
          </div>

          {catalogError ? (
            <p className="mb-4 text-sm text-[var(--rk-danger)]">{catalogError}</p>
          ) : null}
          {loading ? (
            <p className="text-[var(--rk-muted-2)]">
              <Trans>Loading integrations…</Trans>
            </p>
          ) : null}
          {!loading && catalog.length === 0 ? (
            <p className="text-[13.5px] leading-6 text-[var(--rk-muted-2)]">
              {EMPTY_PLUGIN_CATALOG_MESSAGE}
            </p>
          ) : null}
          {!loading && catalog.length > 0 && searching && view.sections.length === 0 ? (
            <p className="text-[var(--rk-muted-2)]">
              <Trans>No apps match your search.</Trans>
            </p>
          ) : null}

          <div className="space-y-1" data-testid="integration-categories">
            {view.sections.map((section) => {
              const open = searching || openSections.has(section.id);
              return (
                <section key={section.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleSection(section.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-[11px] px-1 py-2 text-left text-[14px] text-[var(--rk-soft)] hover:text-[var(--rk-ink)]"
                  >
                    <span>
                      {section.title}
                      <span className="ml-2 text-[var(--rk-muted-2)]">{section.items.length}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`text-[var(--rk-muted)] transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </button>
                  {open ? (
                    <div className="grid grid-cols-2 gap-1 pb-3">
                      {section.items.map((item) => (
                        <div key={`${section.id}:${itemKey(item)}`} className="min-w-0">
                          {renderApp(item)}
                          {renderAccounts(item)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
          <details
            data-testid="integrations-advanced"
            className="group mt-8"
            onToggle={(event) => {
              if (!(event.currentTarget as HTMLDetailsElement).open) {
                setSourceKind(null);
                setSourceError(null);
                setSourceName("");
                setSourceUrl("");
                setCredential("");
                setAuthType("none");
                setAuthName("x-api-key");
              }
            }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] text-[var(--rk-muted)]">
              <span className="text-[var(--rk-muted)]">
                <Trans>Advanced</Trans>
              </span>
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>

            <div className="mt-4 space-y-4">
              {onOpenMcp ? (
                <button
                  type="button"
                  onClick={onOpenMcp}
                  className="rounded-full border border-[var(--rk-border)] px-3 py-1.5 text-xs text-[var(--rk-soft)] hover:bg-[var(--rk-hairline-strong)]"
                >
                  <Trans>MCP servers</Trans>
                </button>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("mcp")}>
                  <Trans>Add MCP server</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("api")}>
                  <Trans>Add OpenAPI</Trans>
                </Button>
                <Button type="button" variant="pill" size="sm" onClick={() => beginSource("treg")}>
                  <Trans>Add Treg</Trans>
                </Button>
              </div>

              {sourceError ? (
                <p className="text-sm text-[var(--rk-danger)]">{sourceError}</p>
              ) : null}

              {sourceKind ? (
                <div className="space-y-3 rounded-[16px] border border-[var(--rk-scroll)] bg-[var(--rk-inset)] p-5">
                  <div className="text-base font-medium text-[var(--rk-ink)]">
                    {sourceKind === "treg" ? (
                      <Trans>Connect Treg</Trans>
                    ) : sourceKind === "mcp" ? (
                      <Trans>Add remote MCP server</Trans>
                    ) : (
                      <Trans>Import OpenAPI JSON</Trans>
                    )}
                  </div>
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder={t`Display name`}
                    className="w-full rounded-xl border border-[var(--rk-scroll)] bg-[var(--rk-hairline)] px-3 py-2.5 text-sm text-[var(--rk-ink)] outline-none"
                  />
                  {sourceKind !== "treg" ? (
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder={
                        sourceKind === "mcp"
                          ? "https://example.com/mcp"
                          : "https://example.com/openapi.json"
                      }
                      className="w-full rounded-xl border border-[var(--rk-scroll)] bg-[var(--rk-hairline)] px-3 py-2.5 text-sm text-[var(--rk-ink)] outline-none"
                    />
                  ) : null}
                  {sourceKind !== "treg" ? (
                    <select
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value as typeof authType)}
                      className="w-full rounded-xl border border-[var(--rk-scroll)] bg-[var(--rk-hairline)] px-3 py-2.5 text-sm text-[var(--rk-ink)] outline-none"
                    >
                      <option value="none">
                        <Trans>No authentication</Trans>
                      </option>
                      <option value="bearer">
                        <Trans>Bearer token</Trans>
                      </option>
                      <option value="header">
                        <Trans>API key header</Trans>
                      </option>
                    </select>
                  ) : null}
                  {authType === "header" && sourceKind !== "treg" ? (
                    <input
                      value={authName}
                      onChange={(event) => setAuthName(event.target.value)}
                      placeholder={t`Header name`}
                      className="w-full rounded-xl border border-[var(--rk-scroll)] bg-[var(--rk-hairline)] px-3 py-2.5 text-sm text-[var(--rk-ink)] outline-none"
                    />
                  ) : null}
                  {sourceKind === "treg" || authType !== "none" ? (
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder={sourceKind === "treg" ? t`Treg token` : t`Credential`}
                      className="w-full rounded-xl border border-[var(--rk-scroll)] bg-[var(--rk-hairline)] px-3 py-2.5 text-sm text-[var(--rk-ink)] outline-none"
                    />
                  ) : null}
                  <p className="text-xs leading-5 text-[#707077]">
                    <Trans>
                      Rakazo verifies the source before saving it. Credentials are encrypted and are
                      never returned to clients or exposed to the model.
                    </Trans>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === "install-source"}
                      onClick={() => void installSource()}
                    >
                      {pending === "install-source" ? (
                        <Trans>Verifying…</Trans>
                      ) : (
                        <Trans>Verify and add</Trans>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      onClick={() => setSourceKind(null)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-3 text-sm font-medium text-[var(--rk-soft)]">
                  <Trans>Tool sources</Trans>
                </div>
                {sources.length === 0 && !sourceKind ? (
                  <p className="text-[var(--rk-muted-2)]">
                    <Trans>No MCP or API tool sources installed yet.</Trans>
                  </p>
                ) : null}
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center gap-4 rounded-[13px] px-3 py-2.5"
                  >
                    <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[var(--rk-scroll)] font-semibold uppercase text-[var(--rk-ink)]">
                      {source.kind === "mcp" ? "M" : "A"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15.5px] font-medium text-[var(--rk-ink)]">
                        {source.name}
                      </div>
                      <div className="truncate text-[13.5px] text-[var(--rk-faint)]">
                        {source.kind.toUpperCase()} · {source.source} ·{" "}
                        {source.secretConfigured ? (
                          <Trans>credential saved</Trans>
                        ) : (
                          <Trans>no auth</Trans>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === source.id}
                      onClick={() => void removeSource(source)}
                    >
                      {pending === source.id ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function AppLogo({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-xl bg-[var(--rk-scroll)] object-contain p-1.5"
      />
    );
  }
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--rk-scroll)] text-sm font-semibold text-[var(--rk-ink)]">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </div>
  );
}
