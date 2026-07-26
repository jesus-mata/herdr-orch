import { IntakeError } from '../domain/errors.ts';

/**
 * The prose a [[Ticket]]'s body carries.
 *
 * Prose only, and deliberately: what to build and what would make it done are
 * genuinely textual and identical across providers, which is why parsing them
 * here keeps the adapters thin. Structure — the parent, the dependency edges — is
 * not parsed. It comes from the Tracker, because each provider expresses it
 * natively and a native edge beats a text convention.
 */
export interface TicketBody {
  readonly whatToBuild: string;
  readonly acceptanceCriteria: readonly string[];
}

const WHAT_TO_BUILD = 'What to build';
const ACCEPTANCE_CRITERIA = 'Acceptance criteria';

/**
 * Reads a Ticket body, or refuses it.
 *
 * The issue template is the only contract the author has to keep, so a body that
 * does not honour it is an intake failure naming the Ticket and the section —
 * never a Ticket that runs with an empty prompt and wastes a night.
 */
export function parseTicketBody(body: string, reference: string): TicketBody {
  const sections = splitSections(body);

  const whatToBuild = requireSection(sections, WHAT_TO_BUILD, reference);
  const acceptance = requireSection(sections, ACCEPTANCE_CRITERIA, reference);
  const acceptanceCriteria = parseItems(acceptance);

  if (acceptanceCriteria.length === 0) {
    throw new IntakeError(
      `Ticket ${reference}: its "${ACCEPTANCE_CRITERIA}" section has no items. ` +
        'Each criterion is a list item, as the issue template writes them.',
    );
  }

  return { whatToBuild, acceptanceCriteria };
}

/** `## Heading` through `###### Heading`, keyed by the heading lowercased. */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headingPattern = /^#{2,6}\s+(.+?)\s*$/;
  let heading: string | undefined;
  let lines: string[] = [];

  const flush = (): void => {
    if (heading !== undefined) sections.set(heading, lines.join('\n').trim());
  };

  for (const line of body.split(/\r?\n/)) {
    const match = headingPattern.exec(line);
    if (match?.[1] === undefined) {
      lines.push(line);
      continue;
    }
    flush();
    heading = match[1].toLowerCase();
    lines = [];
  }
  flush();

  return sections;
}

function requireSection(
  sections: Map<string, string>,
  heading: string,
  reference: string,
): string {
  const content = sections.get(heading.toLowerCase());

  if (content === undefined) {
    throw new IntakeError(
      `Ticket ${reference}: its body has no "${heading}" section. ` +
        `Sections found: ${describeHeadings(sections)}.`,
    );
  }
  if (content === '') {
    throw new IntakeError(`Ticket ${reference}: its "${heading}" section is empty.`);
  }

  return content;
}

/** `- item`, `* item`, and either with a `[ ]` or `[x]` checkbox. */
function parseItems(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split('\n')) {
    const match = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/.exec(line);
    if (match?.[1] !== undefined) items.push(match[1]);
  }
  return items;
}

function describeHeadings(sections: Map<string, string>): string {
  const headings = [...sections.keys()];
  return headings.length === 0 ? 'none' : headings.map((heading) => `"${heading}"`).join(', ');
}
