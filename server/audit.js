import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createRunDirectory,
  resolveAuditOutputRoot,
  resolveSelection
} from './path-utils.js';

const MAX_CAPTURE_BYTES = 25 * 1024 * 1024;

export async function runAudit({ appRoot, config, selectedPaths, steer }) {
  const selection = resolveSelection(selectedPaths);
  const outputRoot = resolveAuditOutputRoot(selection.repoRoot, config.auditOutputDir);
  const skillPath = path.join(appRoot, '.opencode', 'skills', 'repository-audit', 'SKILL.md');
  const skill = fs.readFileSync(skillPath, 'utf8');
  const normalizedSteer = typeof steer === 'string' ? steer.trim() : '';

  const result = config.mockOpenCode
    ? createMockResult(selection, normalizedSteer)
    : await invokeOpenCode({ config, selection, steer: normalizedSteer, skill });

  const audit = validateAuditResult(result);
  const runDirectory = createRunDirectory(outputRoot);
  const generatedAt = new Date().toISOString();
  const files = [];

  for (const [index, finding] of audit.findings.entries()) {
    const fileName = buildFindingFileName(finding, index);
    const filePath = path.join(runDirectory, fileName);
    fs.writeFileSync(
      filePath,
      renderFindingMarkdown({ finding, selection, steer: normalizedSteer, generatedAt }),
      'utf8'
    );
    files.push(filePath);
  }

  return {
    repoRoot: selection.repoRoot,
    scope: selection.relativePaths,
    steer: normalizedSteer,
    outputDirectory: runDirectory,
    findingCount: audit.findings.length,
    summary: audit.summary,
    files
  };
}

async function invokeOpenCode({ config, selection, steer, skill }) {
  const prompt = buildPrompt({ selection, steer, skill, outputDirectoryName: config.auditOutputDir });
  const args = ['run', '--format', 'json', '--dir', selection.repoRoot, '--title', 'Fibonacci repository audit'];

  if (config.openCodeModel) args.push('--model', config.openCodeModel);
  if (config.openCodeAgent) args.push('--agent', config.openCodeAgent);
  if (config.openCodeVariant) args.push('--variant', config.openCodeVariant);
  args.push(...config.openCodeExtraArgs);

  const permissionConfig = {
    $schema: 'https://opencode.ai/config.json',
    formatter: false,
    permission: {
      '*': 'allow',
      edit: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      question: 'deny',
      bash: {
        '*': 'deny',
        pwd: 'allow',
        'ls*': 'allow',
        'file *': 'allow',
        'wc *': 'allow',
        'head *': 'allow',
        'tail *': 'allow',
        'grep *': 'allow',
        'rg *': 'allow',
        'git status*': 'allow',
        'git log*': 'allow',
        'git diff*': 'allow',
        'git show*': 'allow',
        'git ls-files*': 'allow',
        'git grep*': 'allow'
      }
    }
  };

  const { stdout, stderr, exitCode } = await spawnWithInput(config.openCodeBin, args, prompt, {
    cwd: selection.repoRoot,
    timeoutMs: config.openCodeTimeoutMs,
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(permissionConfig)
    }
  });

  const responseText = extractAssistantText(stdout);
  if (!responseText) {
    throw new Error(
      `OpenCode returned no assistant text.${stderr ? `\n\nOpenCode error output:\n${tail(stderr, 3000)}` : ''}`
    );
  }

  try {
    return extractJsonObject(responseText);
  } catch (error) {
    const exitNote = exitCode === 0 ? '' : ` OpenCode exited with code ${exitCode}.`;
    throw new Error(
      `OpenCode did not return the required audit JSON.${exitNote}\n\n${error.message}\n\nLast output:\n${tail(responseText, 5000)}`
    );
  }
}

function buildPrompt({ selection, steer, skill, outputDirectoryName }) {
  const scope = selection.relativePaths.map((item) => `- ${item}`).join('\n');
  const steerText = steer || 'No steer supplied. Perform the general improvement pass defined by the skill.';

  return `You are running a Fibonacci repository audit. Follow the skill below exactly.\n\n${skill}\n\n## Runtime inputs\n\nRepository root: ${selection.repoRoot}\n\nExact selected scope:\n${scope}\n\nSteer:\n${steerText}\n\nThe directory named ${JSON.stringify(outputDirectoryName)} contains prior generated audit material and is never part of the source audit. Ignore it if it already exists.\n\n## Required response schema\n\nReturn exactly one valid JSON object and no Markdown fences. Use this shape:\n\n{\n  "summary": {\n    "project_context": "brief description of the inspected project and scope",\n    "approach": "brief description of the lenses actually applied",\n    "limitations": ["important limitation or missing runtime evidence"]\n  },\n  "findings": [\n    {\n      "title": "specific, action-oriented finding title",\n      "category": "correctness | security | maintainability | performance | testing | accessibility | design | documentation | developer-experience | other",\n      "severity": "critical | high | medium | low",\n      "confidence": 1,\n      "status": "confirmed | likely | needs-verification",\n      "problem": "self-contained explanation of what is wrong",\n      "evidence": [\n        {\n          "path": "repository-relative/path.ext",\n          "line_start": 1,\n          "line_end": 1,\n          "symbol": "optional function, class, component, or config key",\n          "excerpt": "short non-secret excerpt when useful",\n          "observation": "what this evidence demonstrates"\n        }\n      ],\n      "execution_or_data_flow": "relevant control flow, state flow, or user flow",\n      "impact": "credible consequence and affected behavior",\n      "why_current_behavior_is_insufficient": "why existing guards, tests, or conventions do not resolve it",\n      "suggested_resolution": "implementation direction, not a fabricated patch",\n      "acceptance_criteria": ["observable condition for considering the issue addressed"],\n      "verification": ["specific test, inspection, or reproduction step"],\n      "related_paths": ["other repository-relative paths a fixing agent should inspect"],\n      "dependencies_or_constraints": ["constraint, convention, or dependency relevant to the fix"],\n      "open_questions": ["uncertainty that the fixing agent should resolve"]\n    }\n  ]\n}\n\nUse confidence values from 1 to 10. Do not include duplicate findings. An empty findings array is acceptable.`;
}

function extractAssistantText(stdout) {
  const pieces = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === 'text' && typeof event?.part?.text === 'string') {
        pieces.push(event.part.text);
      }
    } catch {
      // A user may add CLI flags that switch away from JSONL. Keep a raw fallback.
    }
  }

  return pieces.length > 0 ? pieces.join('\n') : stripAnsi(stdout).trim();
}

export function extractJsonObject(text) {
  const cleaned = stripAnsi(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue with a balanced-object scan so incidental prose does not destroy a useful result.
  }

  const candidates = findBalancedJsonObjects(cleaned);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      if (parsed && Array.isArray(parsed.findings)) return parsed;
    } catch {
      // Try the previous candidate.
    }
  }

  throw new Error('No valid JSON object with a findings array was found.');
}

function findBalancedJsonObjects(text) {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return results;
}

function validateAuditResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Audit result must be an object.');
  if (!Array.isArray(result.findings)) throw new Error('Audit result must contain a findings array.');

  const findings = result.findings.map((finding, index) => normalizeFinding(finding, index));
  return {
    summary: normalizeSummary(result.summary),
    findings
  };
}

function normalizeSummary(summary) {
  const value = summary && typeof summary === 'object' ? summary : {};
  return {
    project_context: stringValue(value.project_context),
    approach: stringValue(value.approach),
    limitations: stringArray(value.limitations)
  };
}

function normalizeFinding(finding, index) {
  if (!finding || typeof finding !== 'object') {
    throw new Error(`Finding ${index + 1} is not an object.`);
  }

  const title = stringValue(finding.title) || `Untitled finding ${index + 1}`;
  const severity = ['critical', 'high', 'medium', 'low'].includes(finding.severity)
    ? finding.severity
    : 'medium';
  const confidenceNumber = Number(finding.confidence);
  const confidence = Number.isFinite(confidenceNumber)
    ? Math.min(10, Math.max(1, Math.round(confidenceNumber)))
    : 5;

  return {
    title,
    category: stringValue(finding.category) || 'other',
    severity,
    confidence,
    status: stringValue(finding.status) || 'needs-verification',
    problem: stringValue(finding.problem),
    evidence: Array.isArray(finding.evidence)
      ? finding.evidence.filter((item) => item && typeof item === 'object').map(normalizeEvidence)
      : [],
    execution_or_data_flow: stringValue(finding.execution_or_data_flow),
    impact: stringValue(finding.impact),
    why_current_behavior_is_insufficient: stringValue(finding.why_current_behavior_is_insufficient),
    suggested_resolution: stringValue(finding.suggested_resolution),
    acceptance_criteria: stringArray(finding.acceptance_criteria),
    verification: stringArray(finding.verification),
    related_paths: stringArray(finding.related_paths),
    dependencies_or_constraints: stringArray(finding.dependencies_or_constraints),
    open_questions: stringArray(finding.open_questions)
  };
}

function normalizeEvidence(evidence) {
  return {
    path: stringValue(evidence.path),
    line_start: positiveIntegerOrNull(evidence.line_start),
    line_end: positiveIntegerOrNull(evidence.line_end),
    symbol: stringValue(evidence.symbol),
    excerpt: stringValue(evidence.excerpt),
    observation: stringValue(evidence.observation)
  };
}

function renderFindingMarkdown({ finding, selection, steer, generatedAt }) {
  const lines = [
    `# ${finding.title}`,
    '',
    `- **Severity:** ${finding.severity}`,
    `- **Category:** ${finding.category}`,
    `- **Confidence:** ${finding.confidence}/10`,
    `- **Status:** ${finding.status}`,
    `- **Repository:** \`${selection.repoRoot}\``,
    `- **Audit scope:** ${selection.relativePaths.map((item) => `\`${item}\``).join(', ')}`,
    `- **Steer:** ${steer ? steer : 'General improvement pass'}`,
    `- **Generated:** ${generatedAt}`,
    '',
    '## Problem',
    '',
    finding.problem || '_No additional problem statement was supplied._',
    '',
    '## Evidence',
    ''
  ];

  if (finding.evidence.length === 0) {
    lines.push('_No precise source evidence was supplied. Treat this finding as needing verification._', '');
  } else {
    finding.evidence.forEach((evidence, index) => {
      const location = formatEvidenceLocation(evidence);
      lines.push(`### Evidence ${index + 1}: ${location}`, '');
      if (evidence.symbol) lines.push(`**Symbol:** \`${evidence.symbol}\``, '');
      if (evidence.observation) lines.push(evidence.observation, '');
      if (evidence.excerpt) lines.push('```', evidence.excerpt, '```', '');
    });
  }

  appendSection(lines, 'Execution or data flow', finding.execution_or_data_flow);
  appendSection(lines, 'Impact', finding.impact);
  appendSection(lines, 'Why the current behavior is insufficient', finding.why_current_behavior_is_insufficient);
  appendSection(lines, 'Suggested resolution direction', finding.suggested_resolution);
  appendListSection(lines, 'Acceptance criteria', finding.acceptance_criteria);
  appendListSection(lines, 'Verification', finding.verification);
  appendListSection(lines, 'Related paths', finding.related_paths, true);
  appendListSection(lines, 'Dependencies and constraints', finding.dependencies_or_constraints);
  appendListSection(lines, 'Open questions', finding.open_questions);

  lines.push(
    '## Handoff note',
    '',
    'This file describes one independent audit finding. Re-check the cited code before changing it, preserve repository conventions, and verify the acceptance criteria after implementation.',
    ''
  );

  return lines.join('\n');
}

function appendSection(lines, heading, value) {
  lines.push(`## ${heading}`, '', value || '_Not supplied._', '');
}

function appendListSection(lines, heading, values, code = false) {
  lines.push(`## ${heading}`, '');
  if (values.length === 0) lines.push('_None supplied._');
  else values.forEach((value) => lines.push(`- ${code ? `\`${value}\`` : value}`));
  lines.push('');
}

function formatEvidenceLocation(evidence) {
  const filePath = evidence.path || 'Unspecified path';
  if (!evidence.line_start) return `\`${filePath}\``;
  const range = evidence.line_end && evidence.line_end !== evidence.line_start
    ? `${evidence.line_start}-${evidence.line_end}`
    : `${evidence.line_start}`;
  return `\`${filePath}:${range}\``;
}

function buildFindingFileName(finding, index) {
  const prefix = String(index + 1).padStart(3, '0');
  const slug = finding.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'finding';
  return `${prefix}-${finding.severity}-${slug}.md`;
}

function createMockResult(selection, steer) {
  const target = selection.relativePaths[0] || '.';
  return {
    summary: {
      project_context: 'Mock audit used to verify the Fibonacci UI and Markdown output path.',
      approach: steer ? `Mock result using the steer: ${steer}` : 'Mock general improvement pass.',
      limitations: ['OpenCode was not invoked because FIBONACCI_MOCK_OPENCODE=true.']
    },
    findings: [
      {
        title: 'Replace the mock audit before relying on findings',
        category: 'developer-experience',
        severity: 'low',
        confidence: 10,
        status: 'confirmed',
        problem: 'Fibonacci is currently running in mock mode, so this finding only proves that output generation works.',
        evidence: [
          {
            path: target,
            line_start: null,
            line_end: null,
            symbol: '',
            excerpt: '',
            observation: 'The selected scope was accepted and resolved without copying it.'
          }
        ],
        execution_or_data_flow: 'The UI sends local paths to the Node server, which resolves the repository and writes this file.',
        impact: 'No real repository analysis occurs while mock mode is enabled.',
        why_current_behavior_is_insufficient: 'Mock output cannot identify actual defects.',
        suggested_resolution: 'Set FIBONACCI_MOCK_OPENCODE=false and ensure the OpenCode CLI is available on PATH.',
        acceptance_criteria: ['A subsequent run invokes OpenCode and returns repository-grounded findings.'],
        verification: ['Check the terminal for the OpenCode process and inspect cited paths in generated findings.'],
        related_paths: [],
        dependencies_or_constraints: ['OpenCode must be installed and authenticated locally.'],
        open_questions: []
      }
    ]
  };
}

function spawnWithInput(command, args, input, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let capturedBytes = 0;
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new Error(`OpenCode executable not found: ${command}. Set OPENCODE_BIN in .env if it is installed elsewhere.`));
      } else {
        reject(error);
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`OpenCode exceeded the configured timeout of ${timeoutMs}ms.`));
        return;
      }
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        reject(new Error('OpenCode produced more than 25 MB of output. Narrow the scope or steer.');
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, '');
}

function tail(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}
