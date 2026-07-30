# Marketplace patterns used in version 1

Fibonacci does not install or blindly compose third-party marketplace skills. Version 1 studies established public skills and carries forward their most consistent workflow patterns in a small, original audit skill.

Patterns adopted:

- **Multi-axis general review**: correctness, security, maintainability, performance, testing, documentation, and user-facing quality.
- **Steer-driven narrowing**: a supplied steer changes depth and priority without suppressing unrelated critical findings.
- **Repository-grounded evidence**: findings must point to concrete paths and, where possible, line ranges or symbols.
- **Confidence filtering**: speculative observations are excluded or explicitly marked as needing verification.
- **Exact scope**: selected files and folders define the audit scope; the agent should not silently expand it.
- **One actionable handoff per finding**: every output contains enough context for another agent to investigate and fix independently.

Representative sources reviewed:

- SkillsMP `codebase-audit` by justin-pitt/pitt-skills
- Addy Osmani's `code-review-and-quality` and related engineering skills
- OpenAI's `security-threat-model`
- SkillsMP `security-audit` entries
- Vercel's `web-design-guidelines`
- SkillsMP `review-accessibility`

These sources are references for workflow ideas, not runtime dependencies. Their text and scripts are not vendored into Fibonacci.
