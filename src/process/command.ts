import { spawn } from 'node:child_process';

/**
 * The one place the Orchestrator shells out.
 *
 * Git, `gh` and anything else external go through this, for two reasons. It is
 * the seam a test replaces to assert on the exact argv an adapter builds, and it
 * is the only place that has to get the boring parts right: no shell, so no
 * quoting, and a non-zero exit is an error with the stderr attached rather than
 * a silently empty stdout.
 */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd: string;
  /** Merged over the Orchestrator's own environment. */
  readonly env?: Record<string, string> | undefined;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandResult>;

/** A command that exited non-zero, or could not be spawned at all. */
export class CommandError extends Error {
  override readonly name = 'CommandError';
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** `null` when the process was killed by a signal or never started. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(options: {
    command: string;
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    cause?: unknown;
  }) {
    const argv = [options.command, ...options.args].join(' ');
    const detail = options.stderr.trim() || options.stdout.trim() || '(no output)';
    const exit = options.exitCode === null ? 'no exit code' : `exit ${String(options.exitCode)}`;
    super(`\`${argv}\` failed with ${exit}: ${detail}`);
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export const runCommand: CommandRunner = (command, args, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      // No shell: arguments reach the process exactly as written, so nothing
      // here has to be quoted or escaped.
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(
        new CommandError({
          command,
          args,
          cwd: options.cwd,
          exitCode: null,
          stdout,
          stderr,
          cause: error,
        }),
      );
    });

    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new CommandError({ command, args, cwd: options.cwd, exitCode: code, stdout, stderr }),
        );
      }
    });
  });
