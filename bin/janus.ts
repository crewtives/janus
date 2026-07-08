#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import pkg from "../package.json" with { type: "json" };

const main = defineCommand({
  meta: {
    name: "janus",
    version: pkg.version,
    description: "Janus — the personal historian for makers",
  },
  subCommands: {
    pulse: () => import("../src/commands/pulse.ts").then((m) => m.default),
    doctor: () => import("../src/commands/doctor.ts").then((m) => m.default),
    rollup: () => import("../src/commands/rollup.ts").then((m) => m.default),
    monthly: () => import("../src/commands/monthly.ts").then((m) => m.default),
    quarterly: () => import("../src/commands/quarterly.ts").then((m) => m.default),
    yearly: () => import("../src/commands/yearly.ts").then((m) => m.default),
    index: () => import("../src/commands/index.ts").then((m) => m.default),
    enrich: () => import("../src/commands/enrich.ts").then((m) => m.default),
    defuse: () => import("../src/commands/defuse.ts").then((m) => m.default),
    ask: () => import("../src/commands/ask.ts").then((m) => m.default),
    adr: () => import("../src/commands/adr.ts").then((m) => m.default),
    "archive-tracks": () => import("../src/commands/archive-tracks.ts").then((m) => m.default),
    spine: () => import("../src/commands/spine.ts").then((m) => m.default),
    graph: () => import("../src/commands/graph.ts").then((m) => m.default),
    discover: () => import("../src/commands/discover.ts").then((m) => m.default),
    init: () => import("../src/commands/init.ts").then((m) => m.default),
    retry: () => import("../src/commands/retry.ts").then((m) => m.default),
    mcp: () => import("../src/commands/mcp.ts").then((m) => m.default),
    note: () => import("../src/commands/note.ts").then((m) => m.default),
    wrapped: () => import("../src/commands/wrapped.ts").then((m) => m.default),
    demo: () => import("../src/commands/demo.ts").then((m) => m.default),
  },
});

runMain(main);
