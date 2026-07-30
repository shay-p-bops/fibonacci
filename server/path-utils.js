import fs from 'node:fs';
import path from 'node:path';

export function resolveSelection(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('Select a repository folder or one or more files first.');
  }

  const paths = [...new Set(inputPaths.map(resolveExistingPath))];
  const gitRoots = paths.map(findGitRoot).filter(Boolean);

  let repoRoot;
  if (gitRoots.length > 0) {
    const uniqueRoots = [...new Set(gitRoots.map(normalizeForComparison))];
    if (uniqueRoots.length !== 1 || gitRoots.length !== paths.length) {
      throw new Error('All selected paths must belong to the same Git repository.');
    }
    repoRoot = gitRoots[0];
  } else {
    const anchors = paths.map((selectedPath) =>
      fs.statSync(selectedPath).isDirectory() ? selectedPath : path.dirname(selectedPath)
    );
    repoRoot = commonAncestor(anchors);
  }

  for (const selectedPath of paths) {
    if (!isInside(repoRoot, selectedPath)) {
      throw new Error(`Selected path is outside the resolved repository root: ${selectedPath}`);
    }
  }

  return {
    repoRoot,
    paths,
    relativePaths: paths.map((selectedPath) => {
      const relative = path.relative(repoRoot, selectedPath);
      return relative || '.';
    })
  };
}

export function resolveAuditOutputRoot(repoRoot, configuredName) {
  const outputName = configuredName.trim();
  if (!outputName) throw new Error('AUDIT_OUTPUT_DIR cannot be empty.');
  if (path.isAbsolute(outputName)) {
    throw new Error('AUDIT_OUTPUT_DIR must be a path relative to the selected repository.');
  }

  const resolved = path.resolve(repoRoot, outputName);
  if (!isInside(repoRoot, resolved)) {
    throw new Error('AUDIT_OUTPUT_DIR must remain inside the selected repository.');
  }
  return resolved;
}

export function createRunDirectory(outputRoot, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const runDirectory = path.join(outputRoot, stamp);
  fs.mkdirSync(runDirectory, { recursive: true });
  return runDirectory;
}

export function findGitRoot(selectedPath) {
  let current = fs.statSync(selectedPath).isDirectory()
    ? selectedPath
    : path.dirname(selectedPath);

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveExistingPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('The selected path is invalid.');
  }

  const absolute = path.resolve(inputPath.trim());
  if (!fs.existsSync(absolute)) throw new Error(`Selected path no longer exists: ${absolute}`);
  return fs.realpathSync.native(absolute);
}

function commonAncestor(inputPaths) {
  if (inputPaths.length === 0) throw new Error('No paths were supplied.');

  let candidate = path.resolve(inputPaths[0]);
  for (const inputPath of inputPaths.slice(1)) {
    const target = path.resolve(inputPath);
    while (!isInside(candidate, target)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
  return candidate;
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
