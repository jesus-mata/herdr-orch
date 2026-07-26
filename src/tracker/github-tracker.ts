import { IntakeError } from '../domain/errors.ts';
import type { Spec, Ticket } from '../domain/spec.ts';
import { runCommand, type CommandRunner } from '../process/command.ts';
import { parseTicketBody } from './ticket-body.ts';
import type { SpecIntake, Tracker } from './tracker.ts';

/** The label whose presence on a parent issue marks its [[Spec]] ready. */
const READY_LABEL = 'ready-for-agent';
/** The label that makes a child issue a [[HITL Ticket]]. */
const HUMAN_LABEL = 'ready-for-human';

/**
 * How many issues one page holds. A Batch reading more ready Specs than this in
 * one night is not a case worth paginating for yet; it is a case worth noticing,
 * which is what the thrown error does — a page that came back full is a page with
 * something behind it, and silently working from the first hundred would leave
 * Specs unread and unreported, which reads exactly like a quiet night.
 */
const PAGE_SIZE = 100;

/**
 * The projection every issue read goes through.
 *
 * Shaping in `jq` rather than in TypeScript is deliberate: it keeps the adapter's
 * runtime validation down to one small shape instead of GitHub's whole issue
 * schema, and it puts the field names the adapter depends on in one visible place.
 */
const ISSUE_PROJECTION = `[.[] | {
  number,
  title,
  url: .html_url,
  body: (.body // ""),
  state,
  labels: [.labels[].name],
  subIssues: (.sub_issues_summary.total // 0),
  isPullRequest: (.pull_request != null)
}]`;

export interface GitHubTrackerOptions {
  /** `owner/name`. Resolved from `cwd` when omitted. */
  readonly repo?: string | undefined;
  /** Where `gh` runs, which is how it finds its credentials and the repo. */
  readonly cwd?: string | undefined;
  readonly readyLabel?: string | undefined;
  readonly humanLabel?: string | undefined;
  readonly run?: CommandRunner | undefined;
}

interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly state: string;
  readonly labels: readonly string[];
  readonly subIssues: number;
  readonly isPullRequest: boolean;
}

/**
 * GitHub Issues as a [[Tracker]], over the `gh` CLI.
 *
 * `gh` rather than raw HTTP because it already holds the credentials, and because
 * a personal tool that stops working when a token rotates is a tool that stops
 * working at night.
 *
 * A [[Spec]] is an issue carrying the ready label that has sub-issues; its
 * [[Ticket]]s are those sub-issues, in GitHub's own order. A labelled issue with no
 * sub-issues is a Ticket somebody labelled, not a Spec — this repo labels both, so
 * the distinction has to be structural rather than a matter of which label is
 * where. Parent and child come from native sub-issues, so the structure stays
 * visible and editable in GitHub's own UI.
 */
export function createGitHubTracker(options: GitHubTrackerOptions = {}): Tracker {
  const run = options.run ?? runCommand;
  const cwd = options.cwd ?? process.cwd();
  const readyLabel = options.readyLabel ?? READY_LABEL;
  const humanLabel = options.humanLabel ?? HUMAN_LABEL;
  let repo = options.repo;

  const gh = async (args: readonly string[]): Promise<string> => {
    const result = await run('gh', args, { cwd });
    return result.stdout;
  };

  const resolveRepo = async (): Promise<string> => {
    repo ??= (await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])).trim();
    return repo;
  };

  const issues = async (endpoint: string, query: readonly string[]): Promise<GitHubIssue[]> => {
    const stdout = await gh([
      'api',
      endpoint,
      '--method',
      'GET',
      ...query.flatMap((field) => ['-f', field]),
      '--jq',
      ISSUE_PROJECTION,
    ]);
    const parsed = parseIssues(stdout, endpoint);

    if (parsed.length >= PAGE_SIZE) {
      throw new IntakeError(
        `${endpoint} filled a page of ${String(PAGE_SIZE)} and intake does not paginate. ` +
          'Reading only the first page would leave work unread and unreported, so it ' +
          'stops here instead.',
      );
    }
    return parsed;
  };

  /**
   * One parent issue's [[Ticket]]s, or a refusal naming what could not be read.
   *
   * The catch is the whole point. Intake refuses the Spec it cannot read and no
   * other: a malformed Ticket body, or a `gh` call that fails on this Spec's
   * children, costs this Spec its night rather than the Batch's.
   */
  const readSpec = async (target: string, parent: GitHubIssue): Promise<SpecIntake> => {
    try {
      const children = await issues(`repos/${target}/issues/${String(parent.number)}/sub_issues`, [
        `per_page=${String(PAGE_SIZE)}`,
      ]);
      return { kind: 'ready', spec: toSpec(parent, children, humanLabel) };
    } catch (error) {
      return {
        kind: 'refused',
        spec: bareSpec(parent),
        reason: error instanceof Error ? error.message : String(error),
        cause: error,
      };
    }
  };

  return {
    readySpecs: async () => {
      const target = await resolveRepo();
      const labelled = await issues(`repos/${target}/issues`, [
        `labels=${readyLabel}`,
        'state=open',
        `per_page=${String(PAGE_SIZE)}`,
      ]);

      const parents = labelled
        .filter((issue) => !issue.isPullRequest && issue.subIssues > 0)
        // GitHub answers newest-first; issue order is what a human reads the
        // backlog in, and a Batch's outcome should not depend on creation order.
        .sort((left, right) => left.number - right.number);

      const intakes: SpecIntake[] = [];
      for (const parent of parents) {
        intakes.push(await readSpec(target, parent));
      }
      return intakes;
    },
  };
}

function toSpec(
  parent: GitHubIssue,
  children: readonly GitHubIssue[],
  humanLabel: string,
): Spec {
  return {
    ...bareSpec(parent),
    // A closed sub-issue is work already delivered, not work to re-run. Open ones
    // stay in GitHub's order, which is the order the breakdown published them in.
    tickets: children
      .filter((child) => child.state === 'open' && !child.isPullRequest)
      .map((child) => toTicket(child, humanLabel)),
  };
}

/** The Spec's identity alone, which is all a refusal can honestly carry. */
function bareSpec(parent: GitHubIssue): Spec {
  return {
    id: String(parent.number),
    reference: `#${String(parent.number)}`,
    title: parent.title,
    url: parent.url,
    tickets: [],
  };
}

function toTicket(issue: GitHubIssue, humanLabel: string): Ticket {
  const reference = `#${String(issue.number)}`;
  const body = parseTicketBody(issue.body, reference);

  return {
    id: String(issue.number),
    reference,
    title: issue.title,
    url: issue.url,
    whatToBuild: body.whatToBuild,
    acceptanceCriteria: body.acceptanceCriteria,
    needsHuman: issue.labels.includes(humanLabel),
  };
}

/**
 * Reads `gh`'s output, or refuses it.
 *
 * An adapter that shrugged at an unexpected shape would hand the Orchestrator a
 * Spec with an empty Ticket list, which reads exactly like a quiet night.
 */
function parseIssues(stdout: string, endpoint: string): GitHubIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout === '' ? '[]' : stdout);
  } catch (error) {
    throw new IntakeError(
      `gh returned output for ${endpoint} that is not JSON: ${truncate(stdout)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new IntakeError(`gh returned no array of issues for ${endpoint}: ${truncate(stdout)}`);
  }
  return parsed.map((issue, index) => readIssue(issue, `${endpoint}[${String(index)}]`));
}

function readIssue(value: unknown, where: string): GitHubIssue {
  if (typeof value !== 'object' || value === null) {
    throw new IntakeError(`gh returned a non-issue at ${where}`);
  }
  const issue = value as Record<string, unknown>;
  const number = issue['number'];
  const title = issue['title'];
  const url = issue['url'];
  const body = issue['body'];
  const state = issue['state'];
  const labels = issue['labels'];
  const subIssues = issue['subIssues'];

  if (
    typeof number !== 'number' ||
    typeof title !== 'string' ||
    typeof url !== 'string' ||
    typeof body !== 'string' ||
    typeof state !== 'string' ||
    typeof subIssues !== 'number' ||
    !Array.isArray(labels)
  ) {
    throw new IntakeError(`gh returned an issue at ${where} missing fields the adapter needs`);
  }

  return {
    number,
    title,
    url,
    body,
    state,
    subIssues,
    labels: labels.filter((label): label is string => typeof label === 'string'),
    isPullRequest: issue['isPullRequest'] === true,
  };
}

function truncate(text: string, limit = 200): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}
