/**
 * Preserve user answers across regenerations — Phase 2 U5 + U6.
 *
 * The weekly/monthly is regenerated. The `> [!question]+ Questions for you`
 * callout (legacy: "Preguntas para vos") has gaps between questions for the
 * user to answer.
 *
 * If the previous version has user answers (text without `>` or anything not
 * present in the regenerated version), we preserve its literal content.
 * Minimal strategy: if the previous "Questions for you" block is longer than
 * the regenerated one, we assume the difference is user-supplied and
 * substitute the whole block.
 */

interface ExtractedBlock {
  /** Full callout text, without the following line. */
  block: string;
  /** Index where the callout starts. */
  start: number;
  /** Index where it ends (exclusive). */
  end: number;
}

const HEADER_RE = /^>\s*\[!question\]\+?\s+(Questions for you|Preguntas para vos)\s*$/im;

/**
 * Extracts the "Questions for you" callout (legacy: "Preguntas para vos")
 * from a markdown if present. Returns null otherwise.
 */
export function extractQuestionsBlock(markdown: string): ExtractedBlock | null {
  const lines = markdown.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  // The block continues while lines:
  //  - start with `>` (part of the callout), or
  //  - are blank immediately below the callout (user answers), or
  //  - are non-callout text that is clearly a user answer (not starting with `#`, `>`, `[`).
  // It ends when a new heading (`#`, `##`, `###`) appears.
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (/^#{1,6}\s+/.test(line)) break;
    end += 1;
  }
  // Trim trailing blank lines from the block
  while (end > start + 1 && lines[end - 1]!.trim() === "") end -= 1;
  return {
    block: lines.slice(start, end).join("\n"),
    start,
    end,
  };
}

/**
 * Detecta si el bloque previo tiene respuestas del usuario.
 *
 * Heurística: si dentro del bloque hay líneas que NO empiezan con `>` y NO
 * son la línea vacía estructural entre preguntas (que en la versión generada
 * es `> ` o `>`), entonces el usuario escribió algo.
 *
 * También: si la longitud (en chars) del bloque previo es > 1.3x la del
 * regenerado, asumimos respuesta.
 */
export function hasUserAnswers(previousBlock: string, regeneratedBlock: string): boolean {
  // Heurística A: cualquier línea no-callout dentro del bloque previo.
  for (const line of previousBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith(">")) continue;
    // Línea de texto no-callout dentro del bloque → respuesta probable.
    return true;
  }
  // Heurística B: longitud significativamente mayor.
  if (previousBlock.length > regeneratedBlock.length * 1.3) return true;
  return false;
}

/**
 * Si la versión previa tiene respuestas del usuario, devuelve un markdown
 * con el callout previo en lugar del regenerado. Si no, devuelve la
 * regenerada intacta.
 */
export function preserveQuestionAnswers(opts: {
  previous: string;
  regenerated: string;
}): string {
  const prevBlock = extractQuestionsBlock(opts.previous);
  const regenBlock = extractQuestionsBlock(opts.regenerated);
  if (!prevBlock || !regenBlock) return opts.regenerated;
  if (!hasUserAnswers(prevBlock.block, regenBlock.block)) return opts.regenerated;

  const regenLines = opts.regenerated.split("\n");
  const before = regenLines.slice(0, regenBlock.start).join("\n");
  const after = regenLines.slice(regenBlock.end).join("\n");
  return `${before}\n${prevBlock.block}\n${after}`;
}
