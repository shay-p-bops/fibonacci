const state = {
  paths: [],
  running: false
};

const folderButton = document.querySelector('#folderButton');
const filesButton = document.querySelector('#filesButton');
const clearButton = document.querySelector('#clearButton');
const goButton = document.querySelector('#goButton');
const steerInput = document.querySelector('#steer');
const status = document.querySelector('#status');
const selectionList = document.querySelector('#selectionList');
const selectionEmpty = document.querySelector('#selectionEmpty');
const resultPanel = document.querySelector('#resultPanel');
const resultRepo = document.querySelector('#resultRepo');
const resultCount = document.querySelector('#resultCount');
const resultFolder = document.querySelector('#resultFolder');
const resultFiles = document.querySelector('#resultFiles');

folderButton.addEventListener('click', () => choose('folder'));
filesButton.addEventListener('click', () => choose('files'));
clearButton.addEventListener('click', clearSelection);
goButton.addEventListener('click', runAudit);

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
  renderSelection();
  resultPanel.hidden = true;
  setStatus('Select a folder or files to begin.');
}

async function runAudit() {
  if (state.running || state.paths.length === 0) return;

  state.running = true;
  resultPanel.hidden = true;
  setControlsDisabled(true);
  setStatus('OpenCode is auditing the selected scope. This request stays open until the audit completes.');

  try {
    const response = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: state.paths, steer: steerInput.value })
    });
    const result = await readResponse(response);
    renderResult(result);
    setStatus(`Audit complete. ${result.findingCount} finding${result.findingCount === 1 ? '' : 's'} written.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.running = false;
    setControlsDisabled(false);
  }
}

function renderSelection() {
  selectionList.replaceChildren();
  selectionEmpty.hidden = state.paths.length > 0;

  for (const selectedPath of state.paths) {
    const item = document.createElement('li');
    item.textContent = selectedPath;
    selectionList.append(item);
  }
  updateGoButton();
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
  goButton.textContent = state.running ? 'Auditing…' : 'Go';
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}

renderSelection();
