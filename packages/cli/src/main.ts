import { UsageError } from './args.ts';
import { doctor } from './doctor.ts';
import { record } from './record.ts';
import { verify } from './verify.ts';
import { explainCmd } from './explain.ts';
import { bench } from './bench.ts';
import { exportTestCmd, repro } from './repro.ts';

const HELP = `cage: counterfactual minimization for browser bugs

Commands:
  doctor        check Node, Playwright and Chromium
  record        record one run of a flow as a session
  verify        replay a session N times, check it is deterministic
  explain       find the minimal set of conditions that cause the failure
  repro         replay a bundle's minimal failing configuration
  export-test   write a standalone Playwright regression test from a bundle
  bench         score explain against the planted bugs in examples/shop

Run \`cage <command> --help\` for options and examples.`;

const commands: Record<string, (argv: string[]) => Promise<number>> = {
  doctor,
  record,
  verify,
  explain: explainCmd,
  bench,
  repro,
  'export-test': exportTestCmd,
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return 0;
  }
  const run = commands[cmd];
  if (!run) {
    console.error(`Unknown command "${cmd}".\n\n${HELP}`);
    return 1;
  }
  return run(rest);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`cage: ${err.message}`);
      process.exit(1);
    }
    const debug = process.argv.includes('--debug');
    console.error(`cage: ${err instanceof Error ? err.message : String(err)}`);
    if (debug && err instanceof Error) console.error(err.stack);
    else console.error('(re-run with --debug for a stack trace)');
    process.exit(1);
  },
);
