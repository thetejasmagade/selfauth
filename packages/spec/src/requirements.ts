/**
 * Requirement parsing for the SelfAuth specification (ADR 0007).
 *
 * A requirement is written in Markdown as:
 *   - **[AUTHN-LOGIN-001]** (MUST) Login MUST ...
 */

export const REQUIREMENT_LEVELS = ["MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY"] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export interface Requirement {
  /** Stable ID, e.g. `AUTHN-LOGIN-001`. */
  id: string;
  level: RequirementLevel;
  /** True when the requirement has been withdrawn (`(WITHDRAWN)` marker). */
  withdrawn: boolean;
  /** Requirement text with Markdown line breaks collapsed. */
  text: string;
  /** Source document name, e.g. `AUTHENTICATION_SPEC.md`. */
  source: string;
  /** 1-based line number of the definition. */
  line: number;
}

/** Shape of a requirement ID: AREA(-TOPIC)*-NNN. */
export const REQUIREMENT_ID_PATTERN = /[A-Z]+(?:-[A-Z]+)*-\d{3}/;

const DEFINITION = new RegExp(
  String.raw`^\s*-\s+\*\*\[(${REQUIREMENT_ID_PATTERN.source})\]\*\*\s+\((MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\)(\s+\(WITHDRAWN\))?\s*(.*)$`,
);

const REFERENCE = new RegExp(String.raw`\[(${REQUIREMENT_ID_PATTERN.source})\]`, "g");

/** True for MUST / MUST NOT requirements, which require conformance coverage. */
export function isMandatory(requirement: Pick<Requirement, "level" | "withdrawn">): boolean {
  return (
    !requirement.withdrawn && (requirement.level === "MUST" || requirement.level === "MUST NOT")
  );
}

/**
 * Extract requirement definitions from one Markdown document.
 * Continuation lines (indented, until a blank line or the next list item) are
 * appended to the requirement text.
 */
export function parseRequirements(markdown: string, source: string): Requirement[] {
  const lines = markdown.split(/\r?\n/);
  const result: Requirement[] = [];
  let current: Requirement | undefined;

  lines.forEach((raw, index) => {
    const match = DEFINITION.exec(raw);
    if (match) {
      current = {
        id: match[1]!,
        level: match[2] as RequirementLevel,
        withdrawn: match[3] !== undefined,
        text: match[4]!.trim(),
        source,
        line: index + 1,
      };
      result.push(current);
      return;
    }
    const continues = current && raw.trim() !== "" && /^\s+\S/.test(raw) && !/^\s*-\s/.test(raw);
    if (continues && current) {
      current.text = `${current.text} ${raw.trim()}`.trim();
    } else {
      current = undefined;
    }
  });

  return result;
}

/** IDs referenced anywhere in a document as `[ID]` (definitions included). */
export function findRequirementReferences(markdown: string): string[] {
  return [...markdown.matchAll(REFERENCE)].map((m) => m[1]!);
}
