# Unified assistant and Codex runtime

Desktop and mobile share the same backend model pool and execution runtime. Deploy backend/schema changes before updating clients; package native mobile changes as a separate release.

The default surface is one personal conversation. Mobile uses the existing Muse-inspired shell under the Negroni name, with Team alongside Chat. Web and Electron open the personal conversation and expose Team as a secondary tab. Existing Team conversations and bot identities remain available.

## Execution and ownership

`CodexAgentRuntime` starts an isolated Codex app-server for a turn. Codex owns the model/tool loop for the main assistant, temporary helpers and durable specialists. A loopback Responses bridge translates model calls through the existing provider adapters. The Pi agent loop is not used in this mode; the model catalog and model protocol adapters remain shared.

The bridge has a per-run bearer token, binds only to loopback, and forwards only tools supplied by the Negroni executor. Codex receives no provider credentials or inherited user configuration. Host shell, native subagents and native web tools are disabled; side effects go through Negroni's existing authorization, approval and secret handling. Temporary runtime directories are private and removed after process exit.

Conversation history, agent instructions, scoped memory, schedules and jobs remain authoritative in Negroni. Codex threads are ephemeral execution contexts seeded with that history. Restarting a worker does not create a new bot or erase its context. Existing durable run recovery and approval replay still belong to the executor.

- `run_subagent` executes a bounded one-off task on Codex, inherits the authorized tool set, and cannot delegate recursively. Its result returns inside the current turn.
- `spawn_bot` creates a durable specialist with instructions, memory and its own Team conversation. A first `prompt` is sent through the same request/reply mechanism as `message_bot`, so completion wakes the requester in the originating Personal or Team conversation.
- `message_bot` reuses an existing specialist. The assistant checks its teammate directory before creating another.
- Existing routines and durable jobs wake permanent specialists when needed. A persistent agent does not continuously consume model tokens while idle.
- Push payloads carry the space and thread kind. Mobile opens the originating personal conversation for personal results, approvals and failures.

## Model profiles

Set `AGENT_RUNTIME=codex` for the API and worker and point `CODEX_BINARY` at a working Codex CLI executable. `AGENT_RUNTIME=pi` remains an explicit rollback option. The adapter was exercised with Codex CLI 0.155.0-alpha.9; app-server dynamic tools are experimental, so validate a CLI upgrade before deployment.

Connect providers in Settings → Models using the encrypted credential flow, then add individual models to Enabled models. Choose defaults for chat, complex tasks and the optional Auto router. Model identifiers come from the provider catalog; the same model accessed through two providers is two separate choices. Credentials are never stored in routing configuration.

Legacy deployment fallback (used when no member routing is saved), `${DATA_DIR}/agent-routing.json`:

```json
{
  "conversation": { "provider": "deepseek", "modelId": "deepseek-flash" },
  "task": { "provider": "zai", "modelId": "glm-5.3-flash" }
}
```

The conversation profile answers personal chat and performs initial orchestration. For complex work it delegates to the task profile and summarizes the result. Temporary helpers use the task profile even when the assistant omits explicit model arguments. Durable specialists and Team work use the task profile. Both API and worker read the same file. With no profile, existing model selection applies.

Routing occurs before credential resolution, image/tool capability checks and run model metadata are recorded. Credentials are resolved for the active user and space. An unavailable selected connection fails clearly; it does not silently send the request to another provider. Connect a provider before enabling its models.

## Verification

- The offline suite starts the actual Codex binary against a fixture model endpoint: application tool calls, streamed results, ephemeral delegation, history, approval pause, cancellation of a quiet stream and rejection of unregistered tools.
- Unit coverage checks profile selection, scoped credential resolution, no fallback for unavailable routes, and notification destinations.
- Type checks cover adapters, API, worker, web, mobile and testkit. Web production build is checked separately.
- `apps/web/e2e/unified-assistant.spec.ts` covers the default personal chat and optional Team navigation; the harness requires a container runtime for its isolated database.
- Harmless live fixture calls verified GLM-5.3 Flash directly and DeepSeek V4.1 Flash, GPT-6 Luna and Gemini 3.8 Flash through Vercel Gateway, including tool invocation and final text. These checks do not establish availability for other accounts.

Run offline Codex coverage with `CODEX_TEST_BINARY=/path/to/codex pnpm exec vitest run packages/testkit/src/codex-offline.test.ts`. Without that explicit binary, this integration suite is skipped; other tests remain deterministic and offline.

## References

- [Codex app-server](https://developers.openai.com/codex/app-server)
- [DeepSeek model catalog](https://api-docs.deepseek.com/api/list-models/)
- [GLM-5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)


## Connected model pool

Models settings keeps provider credentials separate from enabled provider/model pairs. Multiple models can share one provider key; the same model through different providers remains two choices. Per-member, per-space routing lives in `SpaceMember.modelRouting`, without credentials. `models.saveRouting` checks the connection and auth capabilities before saving. The chat picker persists a bot model override; clearing it selects Auto. Overrides take priority over routing profiles.

Auto uses conversation and task defaults. An optional router model classifies each request against the enabled pool, with no tools, a bounded context and a 30-second deadline. Its usage is recorded against the parent run. Invalid choices fail with a manual-selection recovery path. Helpers can request only enabled pairs once a pool is configured. Both desktop/web and the mobile assistant expose the pool and chat selection.

Desktop reuses the saved server. On macOS an installed Negroni launch agent can start the local backend automatically; setup remains available for missing services, remote configuration and recovery. No remote URL is replaced by local discovery.
