import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSocketPath } from '../src/herdr/socket-path.ts';
import { HerdrError } from '../src/herdr/errors.ts';

// Every expectation here was read off the real `herdr status` on herdr 0.7.5
// (protocol 17) rather than from the XDG spec, because herdr departs from the
// spec in two places: it honours a relative XDG_CONFIG_HOME, and it treats an
// empty session name as an error rather than as absent.

const HOME = '/home/dev';

test('HERDR_SOCKET_PATH wins over everything else', () => {
  const path = resolveSocketPath({
    HERDR_SOCKET_PATH: '/run/custom/herdr.sock',
    HERDR_SESSION: 'nightly',
    XDG_CONFIG_HOME: '/etc/xdg',
    HOME,
  });

  assert.equal(path, '/run/custom/herdr.sock');
});

test('the default session lives at the config directory root', () => {
  assert.equal(resolveSocketPath({ HOME }), '/home/dev/.config/herdr/herdr.sock');
});

test('an explicit "default" session resolves like no session at all', () => {
  assert.equal(
    resolveSocketPath({ HERDR_SESSION: 'default', HOME }),
    '/home/dev/.config/herdr/herdr.sock',
  );
});

test('a named session lives under sessions/<name>', () => {
  assert.equal(
    resolveSocketPath({ HERDR_SESSION: 'nightly', HOME }),
    '/home/dev/.config/herdr/sessions/nightly/herdr.sock',
  );
});

test('XDG_CONFIG_HOME relocates the config directory', () => {
  assert.equal(
    resolveSocketPath({ XDG_CONFIG_HOME: '/etc/xdg', HOME }),
    '/etc/xdg/herdr/herdr.sock',
  );
});

test('XDG_CONFIG_HOME and a named session compose', () => {
  assert.equal(
    resolveSocketPath({ XDG_CONFIG_HOME: '/etc/xdg', HERDR_SESSION: 'nightly', HOME }),
    '/etc/xdg/herdr/sessions/nightly/herdr.sock',
  );
});

test('a relative XDG_CONFIG_HOME is honoured, as herdr honours it', () => {
  assert.equal(
    resolveSocketPath({ XDG_CONFIG_HOME: 'relative/path', HOME }),
    'relative/path/herdr/herdr.sock',
  );
});

test('an empty XDG_CONFIG_HOME is honoured, as herdr honours it', () => {
  assert.equal(resolveSocketPath({ XDG_CONFIG_HOME: '', HOME }), 'herdr/herdr.sock');
});

test('an empty HERDR_SOCKET_PATH is returned verbatim, as herdr uses it verbatim', () => {
  assert.equal(resolveSocketPath({ HERDR_SOCKET_PATH: '', HOME }), '');
});

test('an empty HERDR_SESSION is an error, not the default session', () => {
  assert.throws(() => resolveSocketPath({ HERDR_SESSION: '', HOME }), HerdrError);
});

test('an explicit session name overrides HERDR_SESSION', () => {
  assert.equal(
    resolveSocketPath({ HERDR_SESSION: 'nightly', HOME }, { session: 'other' }),
    '/home/dev/.config/herdr/sessions/other/herdr.sock',
  );
});

test('an explicit socket path overrides the environment', () => {
  assert.equal(
    resolveSocketPath(
      { HERDR_SOCKET_PATH: '/run/env.sock', HOME },
      { socketPath: '/run/arg.sock' },
    ),
    '/run/arg.sock',
  );
});

for (const name of ['.', '..', 'has/slash', 'has space', 'sess:ion', 'café']) {
  test(`rejects the invalid session name ${JSON.stringify(name)}`, () => {
    assert.throws(() => resolveSocketPath({ HERDR_SESSION: name, HOME }), HerdrError);
  });
}

for (const name of ['nightly', 'run-1', 'run_1', 'v1.2', 'ABC123', '...', '-x']) {
  test(`accepts the valid session name ${JSON.stringify(name)}`, () => {
    assert.equal(
      resolveSocketPath({ HERDR_SESSION: name, HOME }),
      `/home/dev/.config/herdr/sessions/${name}/herdr.sock`,
    );
  });
}

test('fails loudly when no home directory can be determined', () => {
  assert.throws(() => resolveSocketPath({}), HerdrError);
});
