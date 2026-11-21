// Driver for the csv-reader-speed-01 entry: reads every case from
// /input/cases.json, answers each one alone with run() from solve.js, and
// writes /output/answers.json in the cases' order. Outside the harness
// container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house baseline runs with V8's incremental marking off, set before
// solve.js is imported so all of its work runs under it; this entry does
// the same.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i].input);
}
// The harness provides /output; creating it here keeps a local run (with
// MAKEFUN_OUTPUT_DIR pointed at a fresh directory) working the same way.
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
