/**
 * @description 收集本次变更的文件
 */

import { spawnSync } from 'node:child_process';

function detectWorkspaceRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return process.cwd();
}

const workspaceRoot = detectWorkspaceRoot();

function runGit(args) {
  const res = spawnSync('git', args, { cwd: workspaceRoot, encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const errOut = (res.stderr || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${errOut}`);
  }
  return (res.stdout || '').toString();
}

function uniqSorted(arr) {
  return [...new Set(arr)].sort();
}

/** 未加入 Git 索引的 src 下 ts/tsx（尊重 .gitignore），与 diff 结果合并后一并扫描 */
function listUntrackedSrcTsFiles() {
  const res = spawnSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'src/'],
    { cwd: workspaceRoot, encoding: 'utf8' }
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const errOut = (res.stderr || '').toString().trim();
    throw new Error(`git ls-files --others failed: ${errOut}`);
  }
  return (res.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => p.startsWith('src/') && !p.startsWith('src/locales/'))
    .filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
}

export function collectChangedFiles() {
  const diffUnstaged = runGit(['diff', '--name-only', 'HEAD']);
  const diffStaged = runGit(['diff', '--cached', '--name-only', 'HEAD']);
  const untracked = listUntrackedSrcTsFiles();

  const candidates = [
    ...diffUnstaged.split('\n'),
    ...diffStaged.split('\n'),
    ...untracked
  ].map((s) => s.trim());
  const changed = uniqSorted(
    candidates.filter(Boolean).filter((p) => p.startsWith('src/') && !p.startsWith('src/locales/'))
  );

  return changed.filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
}


