import { describe, expect, test } from "bun:test";
import {
  extractQuestionsBlock,
  hasUserAnswers,
  preserveQuestionAnswers,
} from "../src/core/reflection/question-preserve.ts";

const REGENERATED = `# Weekly

## TL;DR

> [!summary]+
> Arco

> [!question]+ Preguntas para vos
> 1. ¿Qué te sorprendió?
>
> 2. ¿Qué se trabó dos veces?
>
> _(espacio para responder — preservado en regeneraciones)_

## Navegación

- foo
`;

const WITH_USER_ANSWERS = `# Weekly

## TL;DR

> [!summary]+
> Arco

> [!question]+ Preguntas para vos
> 1. ¿Qué te sorprendió?
>
> 2. ¿Qué se trabó dos veces?

El cambio en la prioridad del checkout — no estaba en el plan original pero terminó siendo el track más fuerte.

La integración con Globex se trabó dos veces por el mismo bug de race.

## Navegación

- foo
`;

describe("reflection/question-preserve", () => {
  test("extractQuestionsBlock finds the block", () => {
    const b = extractQuestionsBlock(REGENERATED);
    expect(b).not.toBeNull();
    expect(b!.block).toContain("Preguntas para vos");
    expect(b!.block).toContain("espacio para responder");
  });

  test("extractQuestionsBlock returns null when there is no section", () => {
    expect(extractQuestionsBlock("# Weekly\n## TLDR\nfoo")).toBeNull();
  });

  test("hasUserAnswers detects non-callout text in the previous block", () => {
    const prev = extractQuestionsBlock(WITH_USER_ANSWERS)!;
    const regen = extractQuestionsBlock(REGENERATED)!;
    expect(hasUserAnswers(prev.block, regen.block)).toBe(true);
  });

  test("hasUserAnswers false when there are no answers", () => {
    const regen = extractQuestionsBlock(REGENERATED)!;
    expect(hasUserAnswers(regen.block, regen.block)).toBe(false);
  });

  test("preserveQuestionAnswers preserves the user's answers", () => {
    const out = preserveQuestionAnswers({
      previous: WITH_USER_ANSWERS,
      regenerated: REGENERATED,
    });
    expect(out).toContain("checkout — no estaba en el plan original");
    expect(out).toContain("race");
    expect(out).not.toContain("_(espacio para responder");
  });

  test("preserveQuestionAnswers does not touch regeneration when there are no answers", () => {
    const out = preserveQuestionAnswers({
      previous: REGENERATED,
      regenerated: REGENERATED,
    });
    expect(out).toContain("_(espacio para responder");
  });
});
