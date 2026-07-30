import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRunDirectory, resolveAuditOutputRoot, resolveSelection } from './path-utils.js';

const MAX_CAPTURE_BYTES = 25 * 1024 * 1024;
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

export async function runAudit({ appRoot, config, selectedPaths, steer }) {
  const selection = resolveSelection(selectedPaths);
  const outputRoot = resolveAuditOutputRoot(selection.repoRoot, config.auditOutputDir);
  const skill = fs.readFileSync(
    path.join(appRoot, '.opencode', 'skills', 'repository-audit', 'SKILL.md'),
    'utf8'
  );
  const normalizedSteer = typeof steer === 'string' ? steer.trim() : '';
  const rawResult = config.mockOpenCode
    ? createMockResult(selection, normalizedSteer)
    : await invokeOpenCode({ config, selection, steer: normalizedSteer, skill });
  const audit = normalizeAudit(rawResult);
  const runDirectory = createRunDirectory(outputRoot);
  const generatedAt = new Date().toISOString();
  const files = audit.findings.map((finding, index) => {
    const filePath = path.join(runDirectory, findingFileName(finding, index));
    fs.writeFileSync(
      filePath,
      renderFinding({ finding, selection, steer: normalizedSteer, generatedAt }),
      'utf8'
    );
    return filePath;
  });

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
  const args = [
    'run', '--format', 'json', '--dir', selection.repoRoot,
    '--title', 'Fibonacci repository audit'
  ];
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

  const processResult = await spawnWithInput(config.openCodeBin, args, buildPrompt({
    selection,
    steer,
    skill,
    outputDirectoryName: config.auditOutputDir
  }), {
    cwd: selection.repoRoot,
    timeoutMs: config.openCodeTimeoutMs,
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(permissionConfig)
    }
  });

  const assistantText = extractAssistantText(processResult.stdout);
  if (!assistantText) {
    const detail = processResult.stderr ? `\n\nOpenCode error output:\n${tail(processResult.stderr, 3000)}` : '';
    throw new Error(`OpenCode returned no assistant text.${detail}`);
  }

  try {
    return extractJsonObject(assistantText);
  } catch (error) {
    const exitNote = processResult.exitCode === 0 ? '' : ` OpenCode exited with code ${processResult.exitCode}.`;
    throw new Error(
      `OpenCode did not return the required audit JSON.${exitNote}\n\n${error.message}\n\nLast output:\n${tail(assistantText, 5000)}`
    );
  }
}

function buildPrompt({ selection, steer, skill, outputDirectoryName }) {
  const scope = selection.relativePaths.map((item) => `- ${item}`).join('\n');
  const steerText = steer || 'No steer supplied. Perform the general improvement pass defined by the skill.';
  return `You are running a Fibonacci repository audit. Follow the skill below exactly.\n\n${skill}\n\n## Runtime inputs\n\nRepository root: ${selection.repoRoot}\n\nExact selected scope:\n${scope}\n\nSteer:\n${steerText}\n\nThe directory named ${JSON.stringify(outputDirectoryName)} contains prior generated audit material and is never part of the source audit. Ignore it if it already exists.\n\n## Required response schema\n\nReturn exactly one valid JSON object and no Markdown fences:\n\n{\n  "summary": {\n    "project_context": "brief project and scope description",\n    "approach": "audit lenses actually applied",\n    "limitations": ["missing runtime evidence or other limitation"]\n  },\n  "findings": [{\n    "title": "specific finding title",\n    "category": "correctness | security | maintainability | performance | testing | accessibility | design | documentation | developer-experience | other",\n    "severity": "critical | high | medium | low",\n    "confidence": 1,\n    "status": "confirmed | likely | needs-verification",\n    "problem": "self-contained explanation",\n    "evidence": [{\n      "path": "repository-relative/path.ext",\n      "line_start": 1,\n      "line_end": 1,\n      "symbol": "optional symbol",\n      "excerpt": "short non-secret excerpt",\n      "observation": "what this demonstrates"\n    }],\n    "execution_or_data_flow": "relevant flow",\n    "impact": "credible consequence",\n    "why_current_behavior_is_insufficient": "why existing behavior does not resolve it",\n    "suggested_resolution": "implementation direction, not a fabricated patch",\n    "acceptance_criteria": ["observable completion condition"],\n    "verification": ["specific test or reproduction step"],\n    "related_paths": ["other repository-relative paths"],\n    "dependencies_or_constraints": ["relevant constraint"],\n    "open_questions": ["uncertainty to resolve"]\n  }]\n}\n\nUse confidence values from 1 to 10. Do not include duplicate findings. An empty findings array is acceptable.`;
}

function extractAssistantText(stdout) {
  const pieces = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === 'text' && typeof event?.part?.text === 'string') pieces.push(event.part.text);
    } catch {
      // Extra CLI arguments may switch the output away from JSONL; the raw fallback below handles that.
    }
  }
  return pieces.length ? pieces.join('\n') : stripAnsi(stdout).trim();
}

export function extractJsonObject(text) {
  const cleaned = stripAnsi(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.findings)) return parsed;
  } catch {
    // Scan balanced objects next.
  }

  for (const candidate of balancedObjects(cleaned).reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.findings)) return parsed;
    } catch {
      // Continue.
    }
  }
  throw new Error('No valid JSON object with a findings array was found.');
}

function balancedObjects(text) {
  const objects = [];
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
    if (character === '"') inString = true;
    else if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function normalizeAudit(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.findings)) {
    throw new Error('Audit result must be an object containing a findings array.');
  }
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {};
  return {
    summary: {
      project_context: text(summary.project_context),
      approach: text(summary.approach),
      limitations: list(summary.limitations)
    },
    findings: result.findings.map(normalizeFinding)
  };
}

function normalizeFinding(value, index) {
  if (!value || typeof value !== 'object') throw new Error(`Finding ${index + 1} is not an object.`);
  const confidence = Number(value.confidence);
  return {
    title: text(value.title) || `Untitled finding ${index + 1}`,
    category: text(value.category) || 'other',
    severity: SEVERITIES.has(value.severity) ? value.severity : 'medium',
    confidence: Number.isFinite(confidence) ? Math.min(10, Math.max(1, Math.round(confidence))) : 5,
    status: text(value.status) || 'needs-verification',
    problem: text(value.problem),
    evidence: Array.isArray(value.evidence) ? value.evidence.filter(isObject).map(normalizeEvidence) : [],
    execution_or_data_flow: text(value.execution_or_data_flow),
    impact: text(value.impact),
    why_current_behavior_is_insufficient: text(value.why_current_behavior_is_insufficient),
    suggested_resolution: text(value.suggested_resolution),
    acceptance_criteria: list(value.acceptance_criteria),
    verification: list(value.verification),
    related_paths: list(value.related_paths),
    dependencies_or_constraints: list(value.dependencies_or_constraints),
    open_questions: list(value.open_questions)
  };
}

function normalizeEvidence(value) {
  return {
    path: text(value.path),
    line_start: positiveInteger(value.line_start),
    line_end: positiveInteger(value.line_end),
    symbol: text(value.symbol),
    excerpt: text(value.excerpt),
    observation: text(value.observation)
  };
}

function renderFinding({ finding, selection, steer, generatedAt }) {
  const lines = [
    `# ${finding.title}`, '',
    `- **Severity:** ${finding.severity}`,
    `- **Category:** ${finding.category}`,
    `- **Confidence:** ${finding.confidence}/10`,
    `- **Status:** ${finding.status}`,
    `- **Repository:** \`${selection.repoRoot}\``,
    `- **Audit scope:** ${selection.relativePaths.map((item) => `\`${item}\``).join(', ')}`,
    `- **Steer:** ${steer || 'General improvement pass'}`,
    `- **Generated:** ${generatedAt}`, '',
    '## Problem', '', finding.problem || '_No additional problem statement was supplied._', '',
    '## Evidence', ''
  ];

  if (!finding.evidence.length) {
    lines.push('_No precise source evidence was supplied. Treat this finding as needing verification._', '');
  } else {
    finding.evidence.forEach((evidence, index) => {
      lines.push(`### Evidence ${index + 1}: ${evidenceLocation(evidence)}`, '');
      if (evidence.symbol) lines.push(`**Symbol:** \`${evidence.symbol}\``, '');
      if (evidence.observation) lines.push(evidence.observation, '');
      if (evidence.excerpt) lines.push('```', evidence.excerpt, '```', '');
    });
  }

  section(lines, 'Execution or data flow', finding.execution_or_data_flow);
  section(lines, 'Impact', finding.impact);
  section(lines, 'Why the current behavior is insufficient', finding.why_current_behavior_is_insufficient);
  section(lines, 'Suggested resolution direction', finding.suggested_resolution);
  listSection(lines, 'Acceptance criteria', finding.acceptance_criteria);
  listSection(lines, 'Verification', finding.verification);
  listSection(lines, 'Related paths', finding.related_paths, true);
  listSection(lines, 'Dependencies and constraints', finding.dependencies_or_constraints);
  listSection(lines, 'Open questions', finding.open_questions);
  lines.push('## Handoff note', '', 'This file describes one independent audit finding. Re-check the cited code before changing it, preserve repository conventions, and verify the acceptance criteria after implementation.', '');
  return lines.join('\n');
}

function section(lines, heading, value) {
  lines.push(`## ${heading}`, '', value || '_Not supplied._', '');
}

function listSection(lines, heading, values, code = false) {
  lines.push(`## ${heading}`, '');
  if (!values.length) lines.push('_None supplied._');
  else values.forEach((value) => lines.push(`- ${code ? `\`${value}\`` : value}`));
  lines.push('');
}

function evidenceLocation(evidence) {
  const filePath = evidence.path || 'Unspecified path';
  if (!evidence.line_start) return `\`${filePath}\``;
  const line = evidence.line_end && evidence.line_end !== evidence.line_start
    ? `${evidence.line_start}-${evidence.line_end}`
    : String(evidence.line_start);
  return `\`${filePath}:${line}\``;
}

function findingFileName(finding, index) {
  const slug = finding.title.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'finding';
  return `${String(index + 1).padStart(3, '0')}-${finding.severity}-${slug}.md`;
}

function createMockResult(selection, steer) {
  return {
    summary: {
      project_context: 'Mock audit used to verify the Fibonacci UI and Markdown output path.',
      approach: steer ? `Mock result using the steer: ${steer}` : 'Mock general improvement pass.',
      limitations: ['OpenCode was not invoked because FIBONACCI_MOCK_OPENCODE=true.']
    },
    findings: [{
      title: 'Replace the mock audit before relying on findings',
      category: 'developer-experience',
      severity: 'low',
      confidence: 10,
      status: 'confirmed',
      problem: 'Fibonacci is currently running in mock mode, so this finding only proves that output generation works.',
      evidence: [{
        path: selection.relativePaths[0] || '.',
        line_start: null,
        line_end: null,
        symbol: '',
        excerpt: '',
        observation: 'The selected scope was accepted and resolved without copying it.'
      }],
      execution_or_data_flow: 'The UI sends local paths to the Node server, which resolves the repository and writes this file.',
      impact: 'No real repository analysis occurs while mock mode is enabled.',
      why_current_behavior_is_insufficient: 'Mock output cannot identify actual defects.',
      suggested_resolution: 'Set FIBONACCI_MOCK_OPENCODE=false and ensure the OpenCode CLI is available on PATH.',
      acceptance_criteria: ['A subsequent run invokes OpenCode and returns repository-grounded findings.'],
      verification: ['Check the terminal for the OpenCode process and inspect cited paths in generated findings.'],
      related_paths: [],
      dependencies_or_constraints: ['OpenCode must be installed and authenticated locally.'],
      open_questions: []
    }]
  };
}

function spawnWithInput(command, args, input, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let capturedBytes = 0;
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutMs);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.on('data', (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish(() => reject(
      error.code === 'ENOENT'
        ? new Error(`OpenCode executable not found: ${command}. Set OPENCODE_BIN in .env if it is installed elsewhere.`)
        : error
    )));
    child.on('close', (exitCode) => finish(() => {
      if (timedOut) return reject(new Error(`OpenCode exceeded the configured timeout of ${timeoutMs}ms.`));
      if (capturedBytes > MAX_CAPTURE_BYTES) return reject(new Error('OpenCode produced more than 25 MB of output. Narrow the scope or steer.'));
      resolve({ stdout, stderr, exitCode });
    }));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') finish(() => reject(error));
    });
    child.stdin.end(input);
  });
}

function isObject(value) { return value && typeof value === 'object'; }
function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function stripAnsi(value) { return value.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, ''); }
function tail(value, maxLength) { return value.length <= maxLength ? value : value.slice(-maxLength); }
