// Smoke test del webhook de Discord. No es parte del bun test suite porque manda
// un mensaje real al canal. Correr manualmente cuando se configure por primera vez.
import { loadConfig } from "../src/config/loader.ts";
import { notifyDiscord, type ProjectResult } from "../src/core/discord.ts";

const config = await loadConfig();
if (!config.discord?.webhookUrl) {
  console.error("FAIL: no hay discord.webhookUrl en config.local.json");
  process.exit(1);
}

const fakeResults: ProjectResult[] = [
  {
    project: "crewtives-janus",
    date: "2026-05-20",
    status: "ok",
    contentPreview: "TL;DR\nSmoke test del webhook — Janus listo para postear pulses diarios. El sistema arrancó, doctor 13/13 OK, ahora valida la cadena hasta Discord.",
    obsidianPath: "/test/pulse.md",
  },
];

console.log("Posteando smoke al webhook…");
await notifyDiscord(config.discord, fakeResults, ["2026-05-20"]);
console.log("✓ ok. Revisá el canal de Discord. Si no aparece, mirá la consola por errores HTTP arriba.");
