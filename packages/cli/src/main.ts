import { doctor } from './doctor.ts';

const HELP = `cage: counterfactual minimization for browser bugs

Commands:
  doctor        check Node, Playwright and Chromium

Run \`cage <command> --help\` for options and examples.`;

const commands: Record<string, (argv: string[]) => Promise<number>> = {
  doctor,
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
    const debug = process.argv.includes('--debug');
    console.error(`cage: ${err instanceof Error ? err.message : String(err)}`);
    if (debug && err instanceof Error) console.error(err.stack);
    else console.error('(re-run with --debug for a stack trace)');
    process.exit(1);
  },
);
