import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { extractRoutingSection, knowledgeRootInstruction } from "./knowledge-root.js";

const MAP = [
  "# PROJECTS — routing map",
  "",
  "## Сейчас",
  "hot topics that change nightly",
  "",
  "## Routing — куда какая задача",
  "",
  "| Тип задачи | HQ |",
  "|---|---|",
  "| me&agent | `Sandbox/me&agent/` |",
  "",
  "## Если задача не подходит",
  "create a new HQ",
].join("\n");

it("is off unless an absolute knowledge root is configured", async () => {
  expect(await knowledgeRootInstruction({})).toBeUndefined();
  expect(await knowledgeRootInstruction({ NEGRONI_KNOWLEDGE_ROOT: "PROJECTS" })).toBeUndefined();
});

it("points at the knowledge root and inlines only its routing section", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge root "));
  try {
    await writeFile(join(root, "AGENTS.md"), MAP);
    const instruction = await knowledgeRootInstruction({ NEGRONI_KNOWLEDGE_ROOT: root });
    expect(instruction).toContain(`"${root}"`);
    expect(instruction).toContain("| me&agent | `Sandbox/me&agent/` |");
    expect(instruction).not.toContain("hot topics");
    expect(instruction).not.toContain("create a new HQ");
    expect(instruction).toMatch(/never search the whole home directory or ~\/Library/);
    expect(instruction).toMatch(/read-only/);
    expect(instruction).not.toContain("— ");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("still guides the agent when the routing map cannot be read", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-missing-"));
  try {
    const instruction = await knowledgeRootInstruction({ NEGRONI_KNOWLEDGE_ROOT: root });
    expect(instruction).toContain(join(root, "AGENTS.md"));
    expect(instruction).not.toContain("Routing map from AGENTS.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("bounds the routing excerpt", () => {
  expect(extractRoutingSection("no routing here")).toBe("");
  const long = `## Routing\n${"x".repeat(10_000)}`;
  expect(extractRoutingSection(long).length).toBeLessThan(4_100);
});
