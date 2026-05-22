// Smoke test con prompt grande (simula tamaño del pulse real).
import { ClaudeCodeRunner } from "../src/runners/claude-code.ts";

// Generar un prompt de ~15KB con contenido realista
const filler = "Esta es una línea de contexto que repite información del proyecto.\n".repeat(200);
const prompt = `Sos un analista de ingeniería. Te paso un montón de contexto a continuación. NO LO PROCESES PROFUNDAMENTE — solo respondé con la palabra exacta "OK" y nada más.

# CONTEXTO LARGO

${filler}

# INSTRUCCIONES

Respondé únicamente con la palabra OK. Sin más texto, sin explicaciones, sin preámbulo.
`;

console.log(`Prompt size: ${(prompt.length / 1024).toFixed(1)} KB`);
console.log("Spawneando claude con prompt por stdin…");

const t0 = Date.now();
const runner = new ClaudeCodeRunner();
const result = await runner.run({
  prompt,
  cwd: process.cwd(),
  model: "sonnet",
  effort: "low",
  maxTurns: 3,
  timeoutMs: 90_000,
  logTag: "big-prompt-test",
});

console.log("\n--- RESULTADO ---");
console.log("sessionId:", result.sessionId);
console.log("result:", JSON.stringify(result.resultText));
console.log("costUsd:", result.totalCostUsd);
console.log("durationMs:", result.durationMs);
console.log("numTurns:", result.numTurns);
console.log("wall_clock:", Date.now() - t0, "ms");

if (!result.resultText.includes("OK")) {
  console.error("FAIL: respuesta no contiene OK");
  process.exit(1);
}
console.log("✓ smoke ok con prompt grande");
