import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAudit } from './audit.js';
import { readConfig } from './env.js';
import { pickPaths } from './native-picker.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(appRoot, 'public');
const config = readConfig(appRoot);
let auditRunning = false;
let latestAuditOutputDirectory = null;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, {
        ok: true,
        mockOpenCode: config.mockOpenCode,
        openCodeBin: config.openCodeBin
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/pick') {
      const body = await readJsonBody(request);
      const paths = await pickPaths(body.type);
      return sendJson(response, 200, { paths });
    }

    if (request.method === 'POST' && url.pathname === '/api/audit') {
      if (auditRunning) return sendJson(response, 409, { error: 'An audit is already running.' });
      auditRunning = true;
      try {
        const body = await readJsonBody(request);
        const result = await runAudit({
          appRoot,
          config,
          selectedPaths: body.paths,
          steer: body.steer
        });
        latestAuditOutputDirectory = path.resolve(result.outputDirectory);
        return sendJson(response, 200, result);
      } finally {
        auditRunning = false;
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/open-path') {
      const body = await readJsonBody(request);
      const targetPath = path.resolve(String(body.path || ''));

      if (!latestAuditOutputDirectory || targetPath !== latestAuditOutputDirectory) {
        return sendJson(response, 403, { error: 'Only the latest audit output folder can be opened.' });
      }

      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        return sendJson(response, 404, { error: 'The audit output folder no longer exists.' });
      }

      await openDirectory(targetPath);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }

    return serveStaticFile(url.pathname, request.method === 'HEAD', response);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}`;
  console.log(`Fibonacci is running at ${url}`);
  console.log(config.mockOpenCode
    ? 'OpenCode mock mode is enabled.'
    : `OpenCode executable: ${config.openCodeBin}`);
});

function openDirectory(targetPath) {
  let command;
  let args;

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [targetPath];
      break;
    case 'win32':
      command = 'explorer.exe';
      args = [targetPath];
      break;
    case 'linux':
      command = 'xdg-open';
      args = [targetPath];
      break;
    default:
      throw new Error(`Opening folders is not supported on ${process.platform}.`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function serveStaticFile(requestPath, headOnly, response) {
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.slice(1));
  const filePath = path.resolve(publicRoot, relativePath);

  if (!isInside(publicRoot, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(response, 404, 'Not found');
  }

  response.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store'
  });
  if (headOnly) return response.end();
  fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(value);
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
