import path from 'node:path';

import { HerdrError } from './errors.ts';

/** The subset of the environment that decides where herdr's socket lives. */
export interface SocketPathEnv {
  readonly HERDR_SOCKET_PATH?: string | undefined;
  readonly HERDR_SESSION?: string | undefined;
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly HOME?: string | undefined;
  readonly USERPROFILE?: string | undefined;
}

export interface SocketPathOptions {
  /** Bypasses resolution entirely. Wins over the environment. */
  readonly socketPath?: string | undefined;
  /** Names a herdr session. Wins over `HERDR_SESSION`. */
  readonly session?: string | undefined;
}

const DEFAULT_SESSION = 'default';

/**
 * Finds the socket of the herdr instance the CLI would talk to.
 *
 * Resolution mirrors herdr 0.7.5 exactly, including two places where herdr
 * departs from the XDG spec — a relative `XDG_CONFIG_HOME` is used as given,
 * and an empty session name is an error rather than an omission. Guessing
 * differently here would point the Orchestrator at a socket the human's `herdr`
 * command does not use, which is the one failure that would make a whole Batch
 * invisible.
 */
export function resolveSocketPath(
  env: SocketPathEnv,
  options: SocketPathOptions = {},
): string {
  if (options.socketPath !== undefined) return options.socketPath;
  // Present-but-empty counts as set: herdr uses the value verbatim and fails to
  // connect, and a client that silently fell back to the default socket instead
  // would talk to a different instance than the CLI does.
  if (env.HERDR_SOCKET_PATH !== undefined) return env.HERDR_SOCKET_PATH;

  const session = options.session ?? env.HERDR_SESSION;
  const configDir = path.join(resolveConfigHome(env), 'herdr');

  if (session === undefined || session === DEFAULT_SESSION) {
    return path.join(configDir, 'herdr.sock');
  }

  assertValidSessionName(session);
  return path.join(configDir, 'sessions', session, 'herdr.sock');
}

function resolveConfigHome(env: SocketPathEnv): string {
  if (env.XDG_CONFIG_HOME !== undefined) return env.XDG_CONFIG_HOME;

  const home = env.HOME ?? env.USERPROFILE;
  if (home === undefined || home === '') {
    throw new HerdrError(
      'cannot locate the herdr socket: neither HERDR_SOCKET_PATH, XDG_CONFIG_HOME nor HOME is set',
    );
  }

  return path.join(home, '.config');
}

const VALID_SESSION_NAME = /^[A-Za-z0-9._-]+$/;

function assertValidSessionName(session: string): void {
  if (session === '') {
    throw new HerdrError('session name cannot be empty');
  }
  if (session === '.' || session === '..') {
    throw new HerdrError("session name cannot be . or ..");
  }
  if (!VALID_SESSION_NAME.test(session)) {
    throw new HerdrError(
      "session name may only contain ASCII letters, numbers, '.', '_' and '-'",
    );
  }
}
