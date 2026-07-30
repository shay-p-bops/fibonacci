import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function pickPaths(type) {
  if (!['folder', 'files'].includes(type)) {
    throw new Error('Picker type must be "folder" or "files".');
  }

  switch (process.platform) {
    case 'darwin':
      return pickWithAppleScript(type);
    case 'win32':
      return pickWithPowerShell(type);
    case 'linux':
      return pickOnLinux(type);
    default:
      throw new Error(`Native path selection is not supported on ${process.platform}.`);
  }
}

async function pickWithAppleScript(type) {
  const script = type === 'folder'
    ? 'set chosenItem to choose folder with prompt "Select a repository folder"\nreturn POSIX path of chosenItem'
    : [
        'set chosenItems to choose file with prompt "Select files to audit" with multiple selections allowed',
        'set output to ""',
        'repeat with chosenItem in chosenItems',
        'set output to output & POSIX path of chosenItem & linefeed',
        'end repeat',
        'return output'
      ].join('\n');

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { maxBuffer: 1024 * 1024 });
    return splitOutput(stdout);
  } catch (error) {
    if (/User canceled/i.test(error.stderr || error.message)) return [];
    throw new Error(`macOS picker failed: ${cleanError(error)}`);
  }
}

async function pickWithPowerShell(type) {
  const script = type === 'folder'
    ? [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$dialog.Description = "Select a repository folder"',
        '$dialog.ShowNewFolderButton = $false',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  [Console]::Out.WriteLine($dialog.SelectedPath)',
        '}'
      ].join('\n')
    : [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
        '$dialog.Title = "Select files to audit"',
        '$dialog.Multiselect = $true',
        '$dialog.Filter = "All files (*.*)|*.*"',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  $dialog.FileNames | ForEach-Object { [Console]::Out.WriteLine($_) }',
        '}'
      ].join('\n');

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded],
      { maxBuffer: 1024 * 1024, windowsHide: true }
    );
    return splitOutput(stdout);
  } catch (error) {
    throw new Error(`Windows picker failed: ${cleanError(error)}`);
  }
}

async function pickOnLinux(type) {
  if (await commandExists('zenity')) {
    const args = ['--file-selection', `--title=${type === 'folder' ? 'Select a repository folder' : 'Select files to audit'}`];
    if (type === 'folder') args.push('--directory');
    else args.push('--multiple', '--separator=\n');
    return executeLinuxPicker('zenity', args);
  }

  if (await commandExists('kdialog')) {
    const args = type === 'folder'
      ? ['--getexistingdirectory', os.homedir(), '--title', 'Select a repository folder']
      : ['--getopenfilename', os.homedir(), '*', '--multiple', '--separate-output', '--title', 'Select files to audit'];
    return executeLinuxPicker('kdialog', args);
  }

  throw new Error('Install zenity or kdialog to use the native picker on Linux.');
}

async function executeLinuxPicker(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
    return splitOutput(stdout);
  } catch (error) {
    if (error.code === 1) return [];
    throw new Error(`${command} picker failed: ${cleanError(error)}`);
  }
}

async function commandExists(command) {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

function splitOutput(output) {
  return output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanError(error) {
  return String(error.stderr || error.message || error).trim();
}
