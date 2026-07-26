import type { CommandRunner } from '../../src/process/command.ts';

export interface RecordedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface FakeRunner {
  readonly runner: CommandRunner;
  readonly calls: readonly RecordedCommand[];
  /** The argv of every call, joined, for a readable assertion. */
  argv(): readonly string[];
}

/**
 * A stand-in for the one place the Orchestrator shells out.
 *
 * The adapters' only real behaviour is the argv they build and the output they
 * read back, so this is the seam their tests need. `reply` receives each call and
 * returns its stdout, or throws to fail it.
 */
export function createFakeRunner(
  reply: (call: RecordedCommand) => string | Error,
): FakeRunner {
  const calls: RecordedCommand[] = [];

  return {
    calls,
    argv: () => calls.map((call) => [call.command, ...call.args].join(' ')),
    runner: (command, args, options) => {
      const call: RecordedCommand = { command, args, cwd: options.cwd };
      calls.push(call);
      const result = reply(call);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({ stdout: result, stderr: '' });
    },
  };
}
