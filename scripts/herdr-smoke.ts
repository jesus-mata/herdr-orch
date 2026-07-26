/**
 * Smoke-checks the herdr client against a live herdr instance.
 *
 * Not part of `npm test`: it needs a running herdr, so it cannot be part of a
 * suite that has to pass anywhere. Run it when the herdr integration itself is
 * in question — after a herdr upgrade, or when a protocol assumption is
 * suspected.
 *
 *   node --experimental-strip-types scripts/herdr-smoke.ts
 *
 * It creates an unfocused scratch workspace, watches its pane, drives that
 * pane's reported agent state, and closes the workspace again.
 */
import { HerdrClient } from '../src/herdr/index.ts';
import { HERDR_PROTOCOL_VERSION, type AgentStatusChange } from '../src/herdr/protocol.ts';

const client = new HerdrClient();
const observed: AgentStatusChange[] = [];
let workspaceId: string | undefined;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

try {
  log(`socket: ${client.socketPath}`);

  const pong = await client.ping();
  log(`ping: herdr ${pong.version}, protocol ${String(pong.protocol)}`);
  if (pong.protocol !== HERDR_PROTOCOL_VERSION) {
    log(
      `WARNING: client models protocol ${String(HERDR_PROTOCOL_VERSION)}, herdr speaks ${String(pong.protocol)}`,
    );
  }

  const snapshot = await client.sessionSnapshot();
  log(
    `session.snapshot: ${String(snapshot.workspaces.length)} workspaces, ` +
      `${String(snapshot.tabs.length)} tabs, ${String(snapshot.panes.length)} panes, ` +
      `${String(snapshot.agents.length)} agents`,
  );

  const created = await client.send<{
    workspace: { workspace_id: string };
    root_pane: { pane_id: string };
  }>('workspace.create', { cwd: process.cwd(), label: 'herdr-orch smoke', focus: false });
  workspaceId = created.workspace.workspace_id;
  const paneId = created.root_pane.pane_id;
  log(`created scratch workspace ${workspaceId}, pane ${paneId}`);

  client.onAgentStatusChange((change) => {
    observed.push(change);
    log(`  event: ${change.paneId} -> ${change.status}`);
  });
  client.onAgentStatusUnavailable((error) => {
    log(`  agent status unavailable: ${error.message}`);
  });

  await client.watchAgentStatus(paneId);
  log('subscribed to pane agent status');

  let seq = 0;
  for (const state of ['working', 'blocked'] as const) {
    seq += 1;
    await client.send('pane.report_agent', {
      pane_id: paneId,
      source: 'herdr-orch-smoke',
      agent: 'claude',
      state,
      seq,
    });
    await waitFor(
      () => observed.some((change) => change.status === state),
      `the ${state} status to be reported`,
    );
  }

  // Reporting `idle` for a pane nobody has looked at surfaces as `done`: herdr's
  // `done` means "finished, and you have not viewed that pane yet". Which of the
  // two arrives is herdr's business, so accept either.
  seq += 1;
  await client.send('pane.report_agent', {
    pane_id: paneId,
    source: 'herdr-orch-smoke',
    agent: 'claude',
    state: 'idle',
    seq,
  });
  await waitFor(
    () => observed.some((change) => change.status === 'idle' || change.status === 'done'),
    'the agent to settle',
  );

  const read = await client.readPane({ paneId, source: 'recent', lines: 5 });
  log(`pane.read: ${String(read.text.length)} characters, truncated=${String(read.truncated)}`);

  const statuses = observed.map((change) => change.status);
  for (const expected of ['working', 'blocked'] as const) {
    if (!statuses.includes(expected)) {
      throw new Error(`missing the ${expected} status; observed ${JSON.stringify(statuses)}`);
    }
  }
  if (!statuses.includes('idle') && !statuses.includes('done')) {
    throw new Error(`the agent never settled; observed ${JSON.stringify(statuses)}`);
  }

  log(`\nOK: observed ${String(observed.length)} status changes (${statuses.join(' -> ')})`);
} finally {
  if (workspaceId !== undefined) {
    await client.send('workspace.close', { workspace_id: workspaceId });
    log(`closed scratch workspace ${workspaceId}`);
  }
  await client.close();
}
