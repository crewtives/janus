// Smoke test — corre `claude -p` real con un prompt mínimo.
// No es parte del bun test suite (no usa describe/test) porque depende de
// auth de claude y conectividad. Correr manualmente: `bun run tests/claude-smoke.ts`
import { ClaudeCodeRunner } from "../src/runners/claude-code.ts";

const runner = new ClaudeCodeRunner();
const result = await runner.run({
  prompt: "Responde solamente con la palabra OK en mayúsculas. Sin más.",
  cwd: process.cwd(),
  model: "sonnet",
  effort: "low",
  maxTurns: 2,
  timeoutMs: 60_000,
});

console.log("sessionId:", result.sessionId);
console.log("result:", JSON.stringify(result.resultText));
console.log("costUsd:", result.totalCostUsd);
console.log("durationMs:", result.durationMs);
console.log("exitCode:", result.exitCode);

if (!result.resultText.includes("OK")) {
  console.error("FAIL: respuesta no contiene OK");
  process.exit(1);
}
console.log("✓ smoke ok");
