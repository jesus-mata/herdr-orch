import { createGit } from '../../src/git/git.ts';
import type { PullRequest } from '../../src/domain/outcome.ts';
import type { Spec, Ticket } from '../../src/domain/spec.ts';
import type { Forge, PullRequestRequest } from '../../src/forge/forge.ts';
import type { SpecIntake, Tracker } from '../../src/tracker/tracker.ts';

export interface FakeTracker extends Tracker {
  /** How many times the Orchestrator asked for ready Specs. */
  reads(): number;
}

/**
 * Intake, already done. Takes Specs, or the intakes themselves where a test
 * cares about a refusal; `failWith` is a backlog that could not be read at all.
 */
export function createFakeTracker(
  specs: readonly (Spec | SpecIntake)[],
  failWith?: Error,
): FakeTracker {
  let reads = 0;
  return {
    readySpecs: () => {
      reads += 1;
      if (failWith !== undefined) return Promise.reject(failWith);
      return Promise.resolve(specs.map(asIntake));
    },
    reads: () => reads,
  };
}

/** A Spec intake refused, as the GitHub adapter would hand one over. */
export function refusedSpec(spec: Spec, reason: string): SpecIntake {
  return { kind: 'refused', spec: { ...spec, tickets: [] }, reason, cause: new Error(reason) };
}

function asIntake(value: Spec | SpecIntake): SpecIntake {
  return 'kind' in value ? value : { kind: 'ready', spec: value };
}

export interface RecordedPush {
  readonly branch: string;
  /** The commit the branch really pointed at when it was pushed. */
  readonly commit: string;
}

export type RecordedPullRequest = PullRequestRequest & PullRequest;

/**
 * The Forge, recording rather than calling out.
 *
 * `pushBranch` still reads the real repository: a push of a branch that does not
 * exist, or that points nowhere, fails here rather than being recorded as a
 * success. The recorded commit is therefore a fact about the repository, which is
 * what the end-to-end test asserts against.
 */
export interface FakeForge extends Forge {
  readonly pushes: readonly RecordedPush[];
  readonly pullRequests: readonly RecordedPullRequest[];
  /** Makes the next push fail, standing in for a Forge that is unreachable. */
  failNextPush(error: Error): void;
}

export function createFakeForge(options: {
  readonly repoRoot: string;
  readonly defaultBranch?: string;
}): FakeForge {
  const git = createGit();
  const pushes: RecordedPush[] = [];
  const pullRequests: RecordedPullRequest[] = [];
  let nextNumber = 100;
  let pushFailure: Error | undefined;

  return {
    pushes,
    pullRequests,

    failNextPush: (error) => {
      pushFailure = error;
    },

    defaultBranch: () => Promise.resolve(options.defaultBranch ?? 'main'),

    // The temporary repository has no remote, so the branch itself is the freshest
    // ref there is. The real Forge fetches first and hands back `origin/<branch>`.
    fetchBase: () => Promise.resolve(options.defaultBranch ?? 'main'),

    pushBranch: async (branch) => {
      if (pushFailure !== undefined) {
        const failure = pushFailure;
        pushFailure = undefined;
        throw failure;
      }
      const commit = await git.exec(['rev-parse', '--verify', `refs/heads/${branch}`], options.repoRoot);
      pushes.push({ branch, commit });
    },

    openPullRequest: (request) => {
      nextNumber += 1;
      const pullRequest: RecordedPullRequest = {
        ...request,
        number: nextNumber,
        url: `https://forge.invalid/pull/${String(nextNumber)}`,
      };
      pullRequests.push(pullRequest);
      return Promise.resolve(pullRequest);
    },
  };
}

/** A Ticket as intake would have produced it, with the boring fields filled in. */
export function ticketFixture(overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket {
  return {
    reference: `#${overrides.id}`,
    title: `Ticket ${overrides.id}`,
    url: `https://forge.invalid/issues/${overrides.id}`,
    whatToBuild: 'Add the thing the Spec needs.',
    acceptanceCriteria: ['The thing exists'],
    needsHuman: false,
    ...overrides,
  };
}

export function specFixture(overrides: Partial<Spec> & Pick<Spec, 'id'>): Spec {
  return {
    reference: `#${overrides.id}`,
    title: `Spec ${overrides.id}`,
    url: `https://forge.invalid/issues/${overrides.id}`,
    tickets: [ticketFixture({ id: `${overrides.id}0` })],
    ...overrides,
  };
}
