import type {
  AdapterContext,
  AgentRuntime,
  AgentRuntimeEvent,
  ManagedConnectorProvider,
} from "@rakazo/adapter-kit";
import type { RadarSettings } from "@rakazo/contracts";
import type { RadarDeliveryDeps } from "./deliver.js";
import type { RadarLearned } from "./learned.js";
import type { RadarModelDeps, radarModels } from "./models.js";
import type { AgendaEvent } from "./observers/types.js";
import type { RadarOwner } from "./profile.js";

export type RadarCycleDeps = RadarModelDeps &
  RadarDeliveryDeps & {
    runtime: AgentRuntime;
    registry: { managed(id: string): ManagedConnectorProvider | undefined } | undefined;
    workerId: string;
    /** Model passes per local day; signals wait once it is spent. Default 300. */
    maxModelPasses?: number;
    /** Where a source's first check starts. Default 24 hours back. */
    initialLookbackMs?: number;
    /** Items judged per cycle. Default 25. */
    judgeCap?: number;
    knowledgeRoot?: string;
    now?: () => Date;
  };

/** Everything one cycle shares across its stages. */
export type RadarCycle = {
  deps: RadarCycleDeps;
  owner: RadarOwner;
  now: Date;
  settings: RadarSettings;
  learned: RadarLearned;
  summary: string;
  conversation: { botId: string; threadId: string };
  request: { botId: string; threadId: string; runId: string };
  adapter: AdapterContext;
  models: ReturnType<typeof radarModels>;
  usage: (event: Extract<AgentRuntimeEvent, { type: "usage" }>) => Promise<void>;
  /** Spends one model pass from today's allowance; false once it is used up. */
  spendPass: () => boolean;
  ownerAddresses: string[];
  agenda: Array<AgendaEvent & { connectionId: string }>;
  /** Language for everything Radar writes to the owner. */
  language: string;
};
