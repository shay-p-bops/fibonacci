import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractJsonObject, runAudit } from '../server/audit.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('extractJsonObject recovers a findings object from surrounding text', () => {
  const result = extractJsonObject('progress\n{"summary":{},"findings":[]}\ndone');
  assert.deepEqual(result.findings, []);
});

test('mock audit writes one Markdown file per finding inside the selected repository', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fibonacci-audit-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'console.log("hello");\n');

  try {
    const result = await runAudit({
      appRoot,
      selectedPaths: [path.join(repo, 'src', 'app.js')],
      steer: 'Focus on maintainability',
      config: {
        auditOutputDir: 'Audit Outputs',
        mockOpenCode: true,
        openCodeBin: 'opencode',
        openCodeModel: '',
        openCodeAgent: '',
        openCodeVariant: '',
        openCodeTimeoutMs: 1000,
        openCodeExtraArgs: []
      }
    });

    assert.equal(result.repoRoot, repo);
    assert.equal(result.findingCount, 1);
    assert.equal(result.files.length, 1);
    assert.ok(result.outputDirectory.startsWith(path.join(repo, 'Audit Outputs')));
    assert.ok(fs.existsSync(result.files[0]));

    const markdown = fs.readFileSync(result.files[0], 'utf8');
    assert.match(markdown, /^# Replace the mock audit/m);
    assert.match(markdown, /## Evidence/);
    assert.match(markdown, /src\/app\.js/);
    assert.match(markdown, /## Acceptance criteria/);
    assert.match(markdown, /## Verification/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
