# Comments

A comment carries what the code cannot say: a constraint, a trap, or the reason a shape is what it is. It is not a second copy of the README, the docs, or a type annotation.

## Limits

| Where | Limit |
|---|---|
| The single block at the top of a file | 10 lines: what the file owns, and what it deliberately does not. |
| Any other block | 10 lines. `@typedef` blocks are exempt: they are contracts read by the page and the Host. |
| A function or constant | Aim for 1–6 lines: the trap and the reason, then `@param` / `@returns`. |

Past the limit, the detail belongs in `docs/` with a one-line pointer left behind — or the code wants a smaller unit.

## Rules

- **Why, not what.** The signature names the parameters and the next line says what it does; repeat neither.
- **One fact, one place.** A rule that lives in `docs/`, `README.md`, a schema `description`, or another comment is linked, not restated.
- **Pointers point at shipped files.** `docs/*.md`, `README.md`, a path, a symbol. A pointer to a file that is not in the repository is unreadable for everyone else, so it is forbidden.
- **Present tense, current behaviour.** No "previously", "as of 0.3", "temporarily", "will be removed".
- **No history lessons.** Background and rejected alternatives belong in the pull request, not in the file.
- **Chinese prose, English identifiers.** Error messages, logs and schema descriptions stay English.

`test/comments.test.js` enforces the two mechanical rules: no reference to a directory that is not in the repository, and no comment block past the limits above. The rest is review.
