import { useRouter } from "expo-router";
import {
  BadgeCheck,
  BrainCircuit,
  Cpu,
  type LucideIcon,
  Mic,
  Plug,
  Search,
  Shapes,
  UserRound,
} from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import {
  filterAppRows,
  VESPER_APP_ROWS,
  type VesperAppRow,
  vesperAppRoute,
  vesperAppRowCopy,
} from "../../../lib/vesper/apps";
import { Empty, Field, LinkRow } from "../kit";
import { s } from "../theme";

const ICONS: Record<VesperAppRow, LucideIcon> = {
  context: BrainCircuit,
  connectors: Plug,
  models: Cpu,
  voice: Mic,
  approvals: BadgeCheck,
  account: UserRound,
  negroni: Shapes,
};

/**
 * Apps.
 *
 * Six Negroni surfaces plus the way back to the full workspace — the set the
 * port spec settled on. Four of them are Negroni screens already, so the row
 * routes to them rather than rebuilding them; those screens keep their own
 * chrome on purpose.
 */
export function VesperAppsScreen({ onSwitchToNegroni }: { onSwitchToNegroni: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const rows = filterAppRows(VESPER_APP_ROWS, query);

  return (
    <View style={{ gap: 18 }}>
      <Field
        label={t("Search")}
        value={query}
        onChangeText={setQuery}
        placeholder={t("Connections, models, voice…")}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {rows.map((row) => {
        const copy = vesperAppRowCopy(row);
        const route = vesperAppRoute(row);
        return (
          <LinkRow
            key={row}
            icon={ICONS[row]}
            title={copy.title}
            detail={copy.detail}
            onPress={() => {
              if (!route) {
                onSwitchToNegroni();
                return;
              }
              router.push(route);
            }}
          />
        );
      })}
      {!rows.length && (
        <Empty
          icon={Search}
          title={t("Nothing here by that name")}
          detail={t("Spaces, bots, groups and the operator settings live in Negroni.")}
        />
      )}
      <Text style={s.small}>
        {t("Vesper shows what one person needs. The rest of the workspace is in Negroni.")}
      </Text>
    </View>
  );
}
