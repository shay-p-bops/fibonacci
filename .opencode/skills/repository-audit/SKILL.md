---
name: repository-audit
description: Performs a read-only, evidence-backed audit of a repository or selected files. Use when asked to identify bugs, risks, quality problems, or improvements with an optional steer such as security, accessibility, performance, design, testing, or maintainability. Produces structured findings for later remediation and never edits source files.
compatibility: opencode
metadata:
  version: "0.1.0"
  mode: "audit-only"
---

# Repository Audit

## Purpose

Inspect the supplied repository scope and identify concrete problems or worthwhile improvements. This is an audit-only workflow. Do not modify source files, configuration, dependencies, Git state, or generated assets.

The output is consumed by Fibonacci, which creates one comprehensive Markdown handoff per finding for a separate fixing agent.

## Inputs

You will receive:

- the repository root
- one or more exact paths in scope
- an optional free-text steer
- a required JSON output contract

Treat the selected paths as authoritative scope. Read surrounding files only when needed to understand imports, callers, configuration, conventions, or runtime behavior. Do not silently turn a narrow file selection into a whole-repository audit.

## Interpret the steer

When a steer is present, make it the primary lens. It may be a category (`security`, `accessibility`, `performance`) or a free-form goal (`reduce accidental complexity in the data layer`). Apply the specialist checks relevant to that goal.

A steer changes emphasis, not reality. Still report an unrelated critical issue encountered directly within scope, but do not broaden the search for unrelated low-value observations.

When no steer is present, perform a general improvement pass across the dimensions that apply to the repository:

- correctness and likely bugs
- security and unsafe trust boundaries
- maintainability and unnecessary complexity
- performance and resource usage
- tests and failure coverage
- accessibility and usability for user interfaces
- design consistency for user-facing code
- documentation, configuration, and developer experience

Do not force every dimension onto every repository.

## Workflow

### 1. Establish context

Identify the project type, languages, important entry points, existing instructions, test structure, and conventions. Read repository guidance such as `README`, `AGENTS.md`, `CONTRIBUTING`, package manifests, build files, and relevant configuration before judging the implementation.

### 2. Map the selected scope

List the selected files or folders and determine their role. Follow relevant references far enough to understand behavior, but keep the finding anchored to the selected scope.

### 3. Apply relevant audit lenses

Choose only lenses that fit the repository and steer. Examples include:

- control-flow and state errors
- invalid assumptions and edge cases
- error handling and recovery gaps
- unsafe input, authorization, secret, or data-handling patterns
- dependency and configuration risks visible in the repository
- expensive loops, duplicate work, blocking operations, leaks, or unbounded growth
- brittle architecture, duplication, confusing coupling, or dead code
- missing, misleading, or low-value tests
- semantic HTML, keyboard behavior, focus, labels, contrast cues, and responsive behavior
- inconsistent visual systems, unclear hierarchy, or implementation that conflicts with the stated design intent

Use repository evidence rather than generic checklists.

### 4. Validate each candidate finding

Before reporting a finding:

- identify the exact path and the smallest useful line range or symbol
- trace enough surrounding behavior to rule out an obvious false positive
- distinguish observed facts from assumptions
- explain the plausible failure or cost
- check whether tests, guards, or configuration already address it
- assign confidence from 1 to 10

Normally report only findings with confidence 7 or higher. A lower-confidence issue may be included only when its potential impact is high and the uncertainty is clearly explained.

Do not invent findings to make the report look complete. An empty findings array is valid.

### 5. Create independent handoffs

Each finding must stand alone. A later agent should be able to understand and address it without reading the other findings or the audit transcript.

Include:

- a specific title
- category and severity
- concise problem statement
- concrete evidence with paths and line ranges or symbols
- relevant execution or data flow
- impact and affected behavior
- why the current implementation is insufficient
- a suggested resolution direction without pretending there is only one valid implementation
- acceptance criteria
- a verification approach
- related paths and dependencies
- open questions or assumptions

### 6. Return only the requested JSON

Do not wrap the result in Markdown fences. Do not add commentary before or after the JSON. Follow the schema supplied in the prompt exactly.

## Severity guidance

- `critical`: likely severe compromise, destructive data loss, or complete core-function failure
- `high`: significant user, security, correctness, or operational impact with a credible path
- `medium`: meaningful defect or maintainability risk that should be scheduled
- `low`: bounded improvement with real value, not personal style preference

## Boundaries

- Never edit or create source files.
- Never install packages.
- Never commit, push, branch, or change Git state.
- Never expose secrets found during inspection; describe their location and type without reproducing secret values.
- Never claim runtime proof when only static evidence exists.
- Never turn preference into a defect without showing repository-specific impact.
- Never merge several unrelated problems into one finding merely because they share a file.
