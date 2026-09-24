import type { CapabilityInstall, Connection, ConnectionCatalogItem } from "@rakazo/contracts";
import {
  buildConnectorCatalogView,
  EMPTY_PLUGIN_CATALOG_MESSAGE,
  POPULAR_CONNECTOR_SECTION_ID,
} from "@rakazo/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppLogo } from "../components/AppLogo";
import { rpc } from "../lib/api";
import { authorizeConnection, type ConnectionPhase } from "../lib/connection-auth";
import { loadLastBotId } from "../lib/last-bot";
import { native, useThemedStyles } from "../lib/native";
import { openConnectionAuthSession } from "../lib/open-auth-session";

type SourceKind = "treg" | "mcp" | "api";

export default function Integrations() {
  const styles = useThemedStyles(createIntegrationsStyles);
  const { width } = useWindowDimensions();
  const catalogColumns = width >= 480 ? 2 : 1;
  const returned = useLocalSearchParams<{ connection?: string; status?: string }>();
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set([POPULAR_CONNECTOR_SECTION_ID]),
  );
  const [connecting, setConnecting] = useState<{ key: string; phase: ConnectionPhase } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accountLabel, setAccountLabel] = useState("");
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [requiresAuth, setRequiresAuth] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [lastBotId, setLastBotId] = useState("");
  const [catalogReady, setCatalogReady] = useState(false);
  const connectionAttempt = useRef<AbortController | null>(null);

  const searching = query.trim().length > 0;
  const view = useMemo(() => buildConnectorCatalogView(catalog, query), [catalog, query]);
  const connectedKeys = useMemo(
    () => new Set(view.connected.map((item) => `${item.connectorId}:${item.slug}`)),
    [view.connected],
  );
  const looseConnections = connections.filter(
    (row) => !connectedKeys.has(`${row.connectorId}:${row.provider}`),
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

  function connectionsFor(item: ConnectionCatalogItem) {
    return connections.filter(
      (row) => row.connectorId === item.connectorId && row.provider === item.slug,
    );
  }

  async function refresh() {
    const [catalogResult, rows] = await Promise.all([
      rpc<ConnectionCatalogItem[]>("connections/catalog"),
      rpc<Connection[]>("connections/list"),
    ]);
    setCatalog(catalogResult);
    setConnections(rows.filter((row) => row.status === "connected" || row.status === "pending"));
    setCatalogReady(true);
    try {
      const installs = await rpc<CapabilityInstall[]>("capabilities/list");
      setSources(installs.filter((item) => item.kind === "mcp" || item.kind === "api"));
    } catch {
      // Tool sources are optional; keep featured/catalog usable if this fails.
    }
  }

  useEffect(() => {
    void refresh().catch((reason) => {
      setCatalogReady(false);
      setCatalogError(reason instanceof Error ? reason.message : "Could not load integrations");
    });
    void loadLastBotId().then(setLastBotId);
    return () => connectionAttempt.current?.abort();
  }, []);

  // Opened from the callback page's deep link (outside an auth session): confirm once.
  useEffect(() => {
    const connectionId = returned.connection;
    if (!connectionId || connectionAttempt.current) return;
    void rpc<Connection>("connections/complete", { connectionId })
      .catch(() => undefined)
      .then(() => refresh())
      .catch(() => undefined);
  }, [returned.connection]);

  function closeAdvanced() {
    setAdvancedOpen(false);
    setSourceKind(null);
    setSourceError(null);
    setName("");
    setUrl("");
    setCredential("");
    setRequiresAuth(true);
  }

  async function notifyAppConnected(item: ConnectionCatalogItem) {
    const botId = lastBotId || (await loadLastBotId());
    if (!botId) return;
    if (botId !== lastBotId) setLastBotId(botId);
    void rpc("onboarding/appConnected", { botId, provider: item.slug }).catch(() => undefined);
  }

  async function connect(item: ConnectionCatalogItem) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    const key = `${item.connectorId}:${item.slug}`;
    setPending(key);
    setConnecting({ key, phase: "authorizing" });
    setCatalogError(null);
    setNotice(null);
    try {
      const started = await rpc<{ connectionId: string; authorizationUrl: string | null }>(
        "connections/begin",
        {
          connectorId: item.connectorId,
          provider: item.slug,
          displayName:
            accountLabel.trim() ||
            (item.connected ? `${item.name} ${connectionsFor(item).length + 1}` : item.name),
        },
      );
      const outcome = await authorizeConnection({
        connectionId: started.connectionId,
        authorizationUrl: started.authorizationUrl,
        openAuthSession: openConnectionAuthSession,
        complete: (connectionId) => rpc<Connection>("connections/complete", { connectionId }),
        signal: controller.signal,
        onPhase: (phase) => setConnecting({ key, phase }),
      });
      if (outcome === "aborted") return;
      if (outcome === "connected") {
        void notifyAppConnected(item);
        setAccountLabel("");
      } else {
        setNotice(`${item.name} is still pending.`);
      }
      await refresh();
    } catch (reason) {
      if (controller.signal.aborted) return;
      setCatalogError(reason instanceof Error ? reason.message : "Could not connect");
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
        setConnecting(null);
      }
    }
  }

  async function revoke(connection: Connection) {
    const key = connection.id;
    setPending(key);
    setCatalogError(null);
    try {
      await rpc("connections/revoke", { connectionId: connection.id });
      await refresh();
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : "Could not revoke connection");
    } finally {
      setPending(null);
    }
  }

  function beginSource(kind: SourceKind) {
    setSourceKind(kind);
    setSourceError(null);
    setName(kind === "treg" ? "Treg" : "");
    setUrl(kind === "treg" ? "https://treg.to/mcp/" : "");
    setCredential("");
    setRequiresAuth(kind === "treg");
  }

  async function addSource() {
    if (!sourceKind) return;
    setPending("source");
    setSourceError(null);
    try {
      await rpc("capabilities/install", {
        kind: sourceKind === "api" ? "api" : "mcp",
        name: name.trim() || (sourceKind === "treg" ? "Treg" : "Custom connector"),
        source: url.trim(),
        credential: credential.trim() || undefined,
        config:
          sourceKind === "treg"
            ? { preset: "treg", auth: { type: "bearer" } }
            : sourceKind === "api"
              ? { openApi: true, auth: { type: requiresAuth ? "bearer" : "none" } }
              : { preset: "custom", auth: { type: requiresAuth ? "bearer" : "none" } },
      });
      setCredential("");
      setSourceKind(null);
      await refresh();
    } catch (reason) {
      setSourceError(reason instanceof Error ? reason.message : "Could not add source");
    } finally {
      setPending(null);
    }
  }

  async function removeSource(source: CapabilityInstall) {
    setPending(source.id);
    setSourceError(null);
    try {
      await rpc("capabilities/remove", { id: source.id });
      setSources((current) => current.filter((item) => item.id !== source.id));
    } catch (reason) {
      setSourceError(reason instanceof Error ? reason.message : "Could not remove source");
    } finally {
      setPending(null);
    }
  }

  function renderApp(item: ConnectionCatalogItem) {
    const key = `${item.connectorId}:${item.slug}`;
    const phase = connecting?.key === key ? connecting.phase : null;
    const accounts = item.connectionCount ?? connectionsFor(item).length;
    const subtitle = phase
      ? phase === "authorizing"
        ? "Waiting for authorization…"
        : "Confirming…"
      : item.connected
        ? accounts > 1
          ? `${accounts} accounts`
          : "Connected"
        : null;
    return (
      <View style={styles.row}>
        <AppLogo name={item.name} logo={item.logo} />
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.title}>
            {item.name}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={item.connected && !phase ? styles.connected : styles.secondary}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.connected ? `Add another ${item.name}` : `Add ${item.name}`}
          disabled={pending === key}
          onPress={() => void connect(item)}
          hitSlop={8}
        >
          {phase ? (
            <ActivityIndicator color={native.label} />
          ) : (
            <Text style={styles.link}>{item.connected ? "Add account" : "Add"}</Text>
          )}
        </Pressable>
      </View>
    );
  }

  function renderAccount(connection: Connection) {
    return (
      <View key={connection.id} style={styles.accountRow}>
        <Text numberOfLines={1} style={[styles.secondary, styles.grow]}>
          {connection.displayName}
          {connection.status !== "connected" ? ` · ${connection.status}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${connection.displayName}`}
          disabled={pending !== null}
          onPress={() => void revoke(connection)}
          hitSlop={8}
        >
          <Text style={styles.remove}>{pending === connection.id ? "Removing…" : "Remove"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {view.connected.length > 0 || looseConnections.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.section}>Connected</Text>
            {view.connected.map((item) => (
              <View key={`${item.connectorId}:${item.slug}`} style={styles.group}>
                {renderApp(item)}
                {connectionsFor(item).map(renderAccount)}
              </View>
            ))}
            {looseConnections.map(renderAccount)}
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search apps"
          placeholder="Search apps"
          placeholderTextColor={native.secondaryLabel}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Account label"
          placeholder="Account label · Personal / Work"
          placeholderTextColor={native.secondaryLabel}
          value={accountLabel}
          onChangeText={setAccountLabel}
          autoCapitalize="words"
          style={styles.input}
        />

        {catalogError ? <Text style={styles.error}>{catalogError}</Text> : null}
        {notice ? <Text style={styles.secondary}>{notice}</Text> : null}

        {!catalogReady ? <ActivityIndicator color={native.fillPressed} /> : null}

        {catalogReady && catalog.length === 0 ? (
          <Text style={styles.secondary}>{EMPTY_PLUGIN_CATALOG_MESSAGE}</Text>
        ) : null}
        {catalogReady && catalog.length > 0 && searching && view.sections.length === 0 ? (
          <Text style={styles.secondary}>No apps match your search.</Text>
        ) : null}

        {view.sections.map((section) => {
          const open = searching || openSections.has(section.id);
          return (
            <View key={section.id} style={styles.group}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => toggleSection(section.id)}
                style={styles.sectionToggle}
              >
                <Text style={styles.sectionTitle}>
                  {section.title}
                  <Text style={styles.sectionCount}> {section.items.length}</Text>
                </Text>
                <Text style={[styles.chevron, open ? styles.chevronOpen : null]}>›</Text>
              </Pressable>
              {open ? (
                <View style={catalogColumns === 2 ? styles.catalogGrid : styles.catalogStack}>
                  {section.items.map((item) => (
                    <View
                      key={`${section.id}:${item.connectorId}:${item.slug}`}
                      style={catalogColumns === 2 ? styles.catalogCell : null}
                    >
                      {renderApp(item)}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          testID="integrations-advanced"
          onPress={() => {
            if (advancedOpen) closeAdvanced();
            else setAdvancedOpen(true);
          }}
          style={styles.advancedToggle}
        >
          <Text style={styles.advancedLabel}>Advanced</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {advancedOpen ? (
          <View style={styles.advancedBody}>
            <View style={styles.actions}>
              {(["mcp", "api", "treg"] as const).map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  onPress={() => beginSource(kind)}
                  style={styles.smallButton}
                >
                  <Text style={styles.buttonLabel}>
                    {kind === "treg"
                      ? "Add Treg"
                      : kind === "mcp"
                        ? "Add MCP server"
                        : "Add OpenAPI"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {sourceError ? <Text style={styles.error}>{sourceError}</Text> : null}

            {sourceKind ? (
              <View style={styles.card}>
                <Text style={styles.title}>
                  {sourceKind === "treg"
                    ? "Connect Treg"
                    : sourceKind === "mcp"
                      ? "Remote MCP server"
                      : "OpenAPI JSON"}
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Display name"
                  placeholderTextColor={native.tertiaryLabel}
                  style={styles.input}
                />
                {sourceKind !== "treg" ? (
                  <TextInput
                    value={url}
                    onChangeText={setUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={
                      sourceKind === "mcp"
                        ? "https://example.com/mcp"
                        : "https://example.com/openapi.json"
                    }
                    placeholderTextColor={native.tertiaryLabel}
                    style={styles.input}
                  />
                ) : null}
                {sourceKind !== "treg" ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setRequiresAuth((value) => !value)}
                    style={styles.authToggle}
                  >
                    <Text style={styles.secondary}>
                      {requiresAuth ? "Bearer authentication" : "No authentication"}
                    </Text>
                  </Pressable>
                ) : null}
                {sourceKind === "treg" || requiresAuth ? (
                  <TextInput
                    value={credential}
                    onChangeText={setCredential}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={sourceKind === "treg" ? "Treg token" : "Bearer token"}
                    placeholderTextColor={native.tertiaryLabel}
                    style={styles.input}
                  />
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending === "source"}
                    onPress={() => void addSource()}
                    style={styles.smallButton}
                  >
                    {pending === "source" ? (
                      <ActivityIndicator color={native.label} />
                    ) : (
                      <Text style={styles.buttonLabel}>Verify and add</Text>
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSourceKind(null)}
                    style={styles.smallButton}
                  >
                    <Text style={styles.buttonLabel}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Text style={styles.section}>Tool sources</Text>
            {sources.length === 0 ? (
              <Text style={styles.secondary}>No custom sources installed.</Text>
            ) : null}
            {sources.map((source) => (
              <View key={source.id} style={styles.row}>
                <View style={styles.grow}>
                  <Text style={styles.title}>{source.name}</Text>
                  <Text numberOfLines={1} style={styles.secondary}>
                    {source.kind.toUpperCase()} · {source.source}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => void removeSource(source)}>
                  <Text style={styles.remove}>
                    {pending === source.id ? "Removing…" : "Remove"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createIntegrationsStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 14 },
    group: { gap: 8 },
    sectionToggle: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: { color: native.label, fontSize: 15, fontWeight: "600" },
    sectionCount: { color: native.tertiaryLabel, fontWeight: "400" },
    chevronOpen: { transform: [{ rotate: "90deg" }] },
    connected: { color: "#4ECB71", fontSize: 13 },
    accountRow: {
      minHeight: 40,
      paddingHorizontal: 12,
      marginLeft: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    section: { color: native.secondaryLabel, fontSize: 14, fontWeight: "600", marginTop: 10 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    smallButton: {
      minHeight: 42,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: native.fill,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonLabel: { color: native.label, fontSize: 14, fontWeight: "600" },
    card: { padding: 16, borderRadius: 16, backgroundColor: native.fill, gap: 12 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: native.fillPressed,
      color: native.label,
      paddingHorizontal: 14,
      fontSize: 15,
    },
    authToggle: { minHeight: 42, justifyContent: "center" },
    catalogGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    catalogStack: { gap: 8 },
    catalogCell: { flexGrow: 1, flexBasis: "47%", maxWidth: "49%" },
    row: {
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: native.fill,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    grow: { flex: 1, gap: 3, minWidth: 0 },
    title: { color: native.label, fontSize: 15, fontWeight: "600" },
    secondary: { color: native.secondaryLabel, fontSize: 13 },
    link: { color: native.label, fontSize: 14, fontWeight: "600" },
    remove: { color: "#E96B6B", fontSize: 14, fontWeight: "600" },
    error: { color: "#E96B6B", fontSize: 14 },
    advancedToggle: {
      marginTop: 8,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    advancedLabel: { color: native.secondaryLabel, fontSize: 14 },
    advancedBody: { gap: 14 },
    chevron: { color: native.secondaryLabel, fontSize: 18 },
  });
}
