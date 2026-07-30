const state = {
  paths: [],
  running: false,
  auditStartedAt: null,
  timerId: null,
  outputDirectory: null
};

const folderButton = document.querySelector('#folderButton');
const filesButton = document.querySelector('#filesButton');
const clearButton = document.querySelector('#clearButton');
const goButton = document.querySelector('#goButton');
const steerInput = document.querySelector('#steer');
const setupDetails = document.querySelector('#setupDetails');
const setupSummary = document.querySelector('#setupSummary');
const actionPanel = document.querySelector('#actionPanel');
const status = document.querySelector('#status');
const activityIndicator = document.querySelector('#activityIndicator');
const auditMeta = document.querySelector('#auditMeta');
const elapsedTimer = document.querySelector('#elapsedTimer');
const progressTrack = document.querySelector('#progressTrack');
const selectionList = document.querySelector('#selectionList');
const selectionEmpty = document.querySelector('#selectionEmpty');
const resultPanel = document.querySelector('#resultPanel');
const resultRepo = document.querySelector('#resultRepo');
const resultCount = document.querySelector('#resultCount');
const resultFolder = document.querySelector('#resultFolder');
const resultFiles = document.querySelector('#resultFiles');
const openResultsButton = document.querySelector('#openResultsButton');

folderButton.addEventListener('click', () => choose('folder'));
filesButton.addEventListener('click', () => choose('files'));
clearButton.addEventListener('click', clearSelection);
goButton.addEventListener('click', runAudit);
steerInput.addEventListener('input', updateSetupSummary);
openResultsButton.addEventListener('click', openResultsFolder);

async function choose(type) {
  setStatus(type === 'folder' ? 'Opening folder picker…' : 'Opening file picker…');
  setControlsDisabled(true);
  try {
    const response = await fetch('/api/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await readResponse(response);
    if (data.paths.length > 0) {
      state.paths = data.paths;
      state.outputDirectory = null;
      renderSelection();
      resultPanel.hidden = true;
      setStatus(`${data.paths.length} path${data.paths.length === 1 ? '' : 's'} selected.`);
    } else {
      setStatus('Selection cancelled.');
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setControlsDisabled(false);
  }
}

function clearSelection() {
  if (state.running) return;
  state.paths = [];
  state.outputDirectory = null;
  renderSelection();
  resultPanel.hidden = true;
  setStatus('Select a folder or files to begin.');
}

async function runAudit() {
  if (state.running || state.paths.length === 0) return;

  state.running = true;
  state.outputDirectory = null;
  resultPanel.hidden = true;
  setControlsDisabled(true);
  setupDetails.open = false;
  startAuditFeedback();
  setStatus('OpenCode is auditing the selected scope. Larger repositories can take a while.');

  try {
    const response = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: state.paths, steer: steerInput.value })
    });
    const result = await readResponse(response);
    const elapsed = stopAuditFeedback();
    state.outputDirectory = result.outputDirectory;
    renderResult(result);
    setStatus(`Audit complete in ${formatElapsed(elapsed)}. ${result.findingCount} finding${result.findingCount === 1 ? '' : 's'} written.`);
  } catch (error) {
    const elapsed = stopAuditFeedback();
    setStatus(`Audit stopped after ${formatElapsed(elapsed)}. ${error.message}`, true);
  } finally {
    stopAuditFeedback();
    state.running = false;
    setControlsDisabled(false);
  }
}

async function openResultsFolder() {
  if (!state.outputDirectory) return;

  openResultsButton.disabled = true;
  openResultsButton.textContent = 'Opening…';
  try {
    const response = await fetch('/api/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.outputDirectory })
    });
    await readResponse(response);
    setStatus('Opened the audit output folder.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    openResultsButton.disabled = false;
    openResultsButton.textContent = 'Open output folder';
  }
}

function startAuditFeedback() {
  state.auditStartedAt = Date.now();
  actionPanel.classList.add('running');
  activityIndicator.hidden = false;
  auditMeta.hidden = false;
  progressTrack.hidden = false;
  elapsedTimer.textContent = '00:00';
  updateGoButton();
  state.timerId = window.setInterval(updateElapsedTimer, 1000);
  actionPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function stopAuditFeedback() {
  const elapsed = state.auditStartedAt ? Date.now() - state.auditStartedAt : 0;

  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  state.auditStartedAt = null;
  actionPanel.classList.remove('running');
  activityIndicator.hidden = true;
  auditMeta.hidden = true;
  progressTrack.hidden = true;
  return elapsed;
}

function updateElapsedTimer() {
  if (!state.auditStartedAt) return;
  elapsedTimer.textContent = formatElapsed(Date.now() - state.auditStartedAt);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderSelection() {
  selectionList.replaceChildren();
  selectionEmpty.hidden = state.paths.length > 0;

  for (const selectedPath of state.paths) {
    const item = document.createElement('li');
    item.textContent = selectedPath;
    selectionList.append(item);
  }

  updateSetupSummary();
  updateGoButton();
}

function updateSetupSummary() {
  if (state.paths.length === 0) {
    setupSummary.textContent = 'Choose scope and optional steer';
    return;
  }

  const scope = `${state.paths.length} path${state.paths.length === 1 ? '' : 's'}`;
  const steer = steerInput.value.trim();
  const lens = steer ? truncate(steer, 64) : 'General improvement pass';
  setupSummary.textContent = `${scope} · ${lens}`;
}

function renderResult(result) {
  resultRepo.textContent = result.repoRoot;
  resultCount.textContent = String(result.findingCount);
  resultFolder.textContent = result.outputDirectory;
  resultFiles.replaceChildren();

  if (result.files.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No finding files were created because the audit returned no findings.';
    resultFiles.append(item);
  } else {
    for (const filePath of result.files) {
      const item = document.createElement('li');
      item.textContent = filePath;
      resultFiles.append(item);
    }
  }

  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setControlsDisabled(disabled) {
  folderButton.disabled = disabled;
  filesButton.disabled = disabled;
  clearButton.disabled = disabled;
  steerInput.disabled = disabled;
  updateGoButton();
}

function updateGoButton() {
  goButton.disabled = state.running || state.paths.length === 0 || folderButton.disabled;
  goButton.textContent = state.running ? 'Auditing' : 'Go';
  goButton.classList.toggle('running', state.running);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}

renderSelection();
