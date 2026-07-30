import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveAuditOutputRoot, resolveSelection } from '../server/path-utils.js';

test('resolveSelection finds the shared Git root for individual files', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fibonacci-paths-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'src'));
  const first = path.join(repo, 'src', 'first.js');
  const second = path.join(repo, 'src', 'second.js');
  fs.writeFileSync(first, '');
  fs.writeFileSync(second, '');

  try {
    const selection = resolveSelection([first, second]);
    assert.equal(selection.repoRoot, repo);
    assert.deepEqual(selection.relativePaths.sort(), ['src/first.js', 'src/second.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('resolveAuditOutputRoot rejects paths that escape the repository', () => {
  assert.throws(
    () => resolveAuditOutputRoot('/tmp/repo', '../outside'),
    /must remain inside/
  );
});
