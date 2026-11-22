// The harness driver: node runs this file, it reads every case from cases.json in the
// input directory, answers each one alone with run() from solve.js, and writes the
// answers, in the cases' order, to answers.json in the output directory. Outside the
// sandbox MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR name those directories instead of
// /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Match the house driver's GC posture: incremental marking off, set before solve.js is
// imported so the reader's work runs under it.
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

// Each case is answered alone, in order; nothing is kept from one case to the next.
const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
