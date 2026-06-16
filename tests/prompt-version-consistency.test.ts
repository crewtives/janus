import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PROMPTS_DIR = join(import.meta.dir, "..", "src", "prompts");

// Guards the class of bug where wrapped-yearly.v3.md was copied from v2 and kept
// `prompt_version: v2` in its frontmatter — the literal the LLM copies to disk,
// so the first real Wrapped would be sealed with the wrong version. Prompts that
// inject the version at render time (`<%= it.promptVersion %>`) are exempt.
describe("prompt_version consistency", () => {
  test("a literal prompt_version matches the prompt's filename version", async () => {
    const files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);

    const mismatches: string[] = [];
    for (const file of files) {
      const fileVersion = file.match(/\.v(\d+)\.md$/)?.[1];
      if (!fileVersion) continue;
      const content = await readFile(join(PROMPTS_DIR, file), "utf-8");
      const declared = content.match(/^prompt_version:\s*v(\d+)\s*$/m)?.[1];
      if (!declared) continue; // eta-templated — version set programmatically at render
      if (declared !== fileVersion) {
        mismatches.push(`${file} declares prompt_version: v${declared} (expected v${fileVersion})`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
