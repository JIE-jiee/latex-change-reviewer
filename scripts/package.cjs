const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stage = path.join(root, '.cache', `package-stage-${manifest.version}-${process.pid}-${Date.now()}`);
const output = path.join(root, 'artifacts', `latex-change-reviewer-${manifest.version}.vsix`);
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
// Package only distributable files; never scan test profiles, IPC endpoints or dependencies.
for (const name of ['package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'package.nls.ja.json', 'README.md']) {
  fs.copyFileSync(path.join(root, name), path.join(stage, name));
}
const target = path.join(stage, 'dist', 'src');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(stage, '.vscodeignore'), '**/*.map\n');
for (const name of fs.readdirSync(path.join(root, 'dist', 'src'))) {
  if (name.endsWith('.js')) {
    const source = fs.readFileSync(path.join(root, 'dist', 'src', name), 'utf8');
    fs.writeFileSync(path.join(target, name), source.replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
  }
}
const result = spawnSync(process.execPath, [path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'),
  'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', output],
  { cwd: stage, shell: false, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
