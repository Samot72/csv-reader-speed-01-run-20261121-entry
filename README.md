# csv-reader-speed-01 — a faster drop-in

[![Competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Samot72/csv-reader-speed-01-run-20261121-entry/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Samot72/csv-reader-speed-01-run-20261121-entry/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A dependency-free, faster drop-in for make.fun's csv-reader 1.0.0, built for
the make.fun competition
[csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121).
`run(input)` returns exactly the answer csv-reader 1.0.0 returns for every
input — byte-identical `{columns, rows, errors}` — and wins on CPU time.

## The semantics contract

The text is read once, left to right, with commas and double quotes: a U+FEFF
at its very start is dropped; a record ends at LF or CRLF and a line left with
no characters is no record; outside quotes a CR not followed by LF is dropped
(`stray_cr`); a field that opens with a quote runs to the next quote that is
not doubled (`""` inside it is one quote, and each CRLF or lone CR inside it
is read as LF), what follows its closing quote up to the next comma or line
break is appended as it stands (`quote_junk`, when the field ends), and a
quote that never closes is a literal character with the text after it read
again as unquoted (`unterminated_quote`); a quote inside an unquoted field is
a literal character; fields stay strings, never trimmed or converted;
`columns` is the first record when `header` is true, else null, and `rows`
holds the records after it (every record when `header` is false), each padded
with empty strings (`short_row`, with `fields`: its field count) or cut
(`long_row`, with `extra`: the cut fields) to the first record's width; each
error is `{code, line, row}` in the order met, a record's `short_row` or
`long_row` when it ends, where `line` is the 1-based line its record starts
on, counting every LF, CRLF and lone CR inside quotes, and `row` is its
record's index in `rows`, null for the header.

## How the speed is achieved

The reference reader builds every field one character at a time
(`value += c`) and allocates a result object per field. This reader instead:

- **Per-record fast path.** A record whose first line holds no quote and no
  CR (a trailing CR is its CRLF ending, stripped) cannot open a quoted field,
  drop a stray CR or span lines, so the record is exactly that line split at
  its commas — one native `split(',')` call. The checks run on the sliced
  line only, so their cost stays inside the line.
- **Segment scanning for everything else.** Quoted, junk-suffixed,
  stray-CR and unterminated fields are scanned with a tight `charCodeAt`
  loop that only remembers where the current clean segment starts; each
  field is then taken with a single `slice`, and segments are joined only
  when a stray CR, an escaped quote or a CR inside quotes forces a join.
- **No per-field allocation.** Field results travel through shared slots
  instead of fresh `{value, ended, added}` objects, and errors are pushed
  as plain objects only when they actually occur.
- `main.ts` runs with V8's incremental marking off
  (`--no-incremental-marking`), the same tuning the house baseline uses.

## Correctness: differential testing

The reader was verified against the reference csv-reader 1.0.0 itself:

- **18,530 randomised and hand-written differential cases** — token soup of
  quotes, doubled quotes, commas, LF/CRLF/lone-CR mixes, BOMs, empty lines,
  ragged rows, unterminated quotes, quote junk, stray CRs, unicode, huge
  fields (100k characters) and many-row files, each under both `header`
  values — deep-equal on every single one.
- **The kit's practice set (6 cases, ~11 MB): identical to the reference
  reader on all 6, and identical to the kit's published expected outputs on
  all 6.**
- `main.ts` run end-to-end on a fabricated `/input/cases.json`: its
  `/output/answers.json` matches the reference reader's answers on every
  case.

Local timing on the practice set (this machine, median of 5 runs after a
warm-up): **~98 ms vs the reference's ~558 ms — about 5.7× faster.**

## Files

- `solve.js` — the reader: a dependency-free ES module exporting
  `run(input)`, where `input` is `{text, header}` and the return is
  `{columns, rows, errors}`.
- `main.ts` — the harness driver: reads every case from
  `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`.
- `LICENSE` — MIT.

## Run it

```sh
# harness layout (Node 22.18+)
node main.ts            # reads /input/cases.json, writes /output/answers.json

# locally, with stand-in directories
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```
