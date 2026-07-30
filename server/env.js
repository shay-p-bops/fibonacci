import fs from 'node:fs';
import path from 'node:path';

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

export function readConfig(appRoot) {
  loadEnvFile(path.join(appRoot, '.env'));

  return {
    host: process.env.HOST || '127.0.0.1',
    port: parseInteger(process.env.PORT, 4173),
    openCodeBin: process.env.OPENCODE_BIN || 'opencode',
    openCodeModel: process.env.OPENCODE_MODEL || '',
    openCodeAgent: process.env.OPENCODE_AGENT || '',
    openCodeVariant: process.env.OPENCODE_VARIANT || '',
    openCodeTimeoutMs: parseInteger(process.env.OPENCODE_TIMEOUT_MS, 1_800_000),
    auditOutputDir: process.env.AUDIT_OUTPUT_DIR || 'Audit Outputs',
    openCodeExtraArgs: parseJsonArray(process.env.OPENCODE_EXTRA_ARGS_JSON || '[]'),
    mockOpenCode: /^true$/i.test(process.env.FIBONACCI_MOCK_OPENCODE || 'false')
  };
}

function parseInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('Expected an array of strings');
    }
    return parsed;
  } catch (error) {
    throw new Error(`OPENCODE_EXTRA_ARGS_JSON is invalid: ${error.message}`);
  }
}
