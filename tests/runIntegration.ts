import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const projectRoot = path.resolve(__dirname, '../..');
const cacheRoot = path.join(projectRoot, '.cache', 'vscode');
const profile = `test-${process.env.REVIEW_CODE_EXECUTABLE ? 'local' : process.env.REVIEW_CODE_VERSION || '1.85.2'}${process.env.REVIEW_PACKAGED === '1' ? '-packaged' : ''}`;
const userDataDir = path.join(cacheRoot, profile);
const extensionsDir = path.join(cacheRoot, 'extensions');

async function main(): Promise<number> {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  const packaged = process.env.REVIEW_PACKAGED === '1';
  const tempDir = path.join(projectRoot, '.cache', 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.TEMP = tempDir; process.env.TMP = tempDir;
  const executable = process.env.REVIEW_CODE_EXECUTABLE || await downloadAndUnzipVSCode({
    version: process.env.REVIEW_CODE_VERSION || '1.85.2', cachePath: cacheRoot
  });
  const args = [
    `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
    `--crash-reporter-directory=${path.join(cacheRoot, 'crashes')}`,
    '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--disable-gpu', '--disable-telemetry', '--new-window',
    `--extensionTestsPath=${path.join(projectRoot, 'dist', 'tests', 'integration.js')}`
  ];
  // VS Code runs extensionTestsPath only in an extension development host.
  // In package mode point that host at the installed VSIX, never the source tree.
  const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
  const installed = packaged ? fs.readdirSync(extensionsDir).find(name => name === `local-latex-tools.latex-change-reviewer-${version}`) : undefined;
  if (packaged && !installed) throw new Error('Install the VSIX into .cache/vscode/extensions before packaged tests.');
  args.push(`--extensionDevelopmentPath=${packaged ? path.join(extensionsDir, installed!) : projectRoot}`);
  const env: NodeJS.ProcessEnv = { ...process.env, REVIEW_PACKAGED: packaged ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  // shell:false is essential: the official Windows launcher splits paths containing spaces.
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail: string[] = [];
    const collect = (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/).filter(Boolean);
      tail.push(...lines); if (tail.length > 100) tail.splice(0, tail.length - 100);
      for (const line of lines) if (/LaTeX Change Reviewer integration checks passed/.test(line)) console.log(line);
    };
    child.stdout!.on('data', collect); child.stderr!.on('data', collect);
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) console.error(tail.slice(-30).join('\n'));
      resolve(code ?? 1);
    });
    process.once('SIGINT', () => child.kill());
  });
}

if (require.main === module) {
  main().then(code => {
    if (code === 0) console.log('VS Code integration test run completed.');
    process.exitCode = code;
  }, error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
