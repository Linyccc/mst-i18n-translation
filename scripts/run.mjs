import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawnSync } from 'node:child_process';

import { collectChangedFiles } from './collect-changed-files.mjs';
import { extractKeysFromGitRef, extractKeysFromWorktree, diffKeys } from './extract-i18n-keys.mjs';
import {
  extractFromGitRef,
  extractFromWorktree,
  diffPotentialConfig,
  diffPotentialConfigRemoved,
  isValueReferencedInSourceTree
} from './extract-potential-config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function detectWorkspaceRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return process.cwd();
}

const workspaceRoot = detectWorkspaceRoot();
const runtimeDir = path.join(skillDir, '.runtime');
const outputPath = path.join(runtimeDir, 'translation-collect.json');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function listLocaleLangs() {
  const localeRoot = path.join(workspaceRoot, 'src/locales');
  const entries = await fs.readdir(localeRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function openFileInCursor(filePath) {
  const p = path.resolve(filePath);
  exec(`cursor "${p}"`, () => {});
}

export async function main() {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');

  await ensureDir(runtimeDir);

  const changedFiles = collectChangedFiles();
  const i18nAdded = [];
  const i18nRemoved = [];
  const potentialConfigAdded = [];
  const potentialConfigRemoved = [];

  for (const relFilePath of changedFiles) {
    const oldKeys = await extractKeysFromGitRef(relFilePath, 'HEAD');
    const newKeys = await extractKeysFromWorktree(relFilePath);
    const { added, removed } = diffKeys(oldKeys, newKeys);
    i18nAdded.push(...added);
    i18nRemoved.push(...removed);

    const oldConfig = await extractFromGitRef(relFilePath, 'HEAD');
    const newConfig = await extractFromWorktree(relFilePath);
    potentialConfigAdded.push(...diffPotentialConfig(oldConfig, newConfig));
    potentialConfigRemoved.push(...diffPotentialConfigRemoved(oldConfig, newConfig));
  }

  // 配置化词条：以 value 作为 key（未用 t/Trans 包裹的潜在配置文本）
  const configAddedKeys = [...new Set(potentialConfigAdded.map((r) => r.value))].filter(Boolean);
  const configRemovedCandidates = [...new Set(potentialConfigRemoved)].filter(Boolean);

  // removed 走保守策略：仅当文案在 src/**/*.ts(x) 无任何引用时，才判定可删
  const configRemovedKeys = configRemovedCandidates.filter((value) => !isValueReferencedInSourceTree(value));

  const addedKeys = [...new Set([...i18nAdded, ...configAddedKeys])].sort();
  const removedKeys = [...new Set([...i18nRemoved, ...configRemovedKeys])].sort();

  const langs = await listLocaleLangs();

  // add: 各语言下 新增词条 -> 翻译值（en=key 本身，其他暂时用空字符串占位）
  const add = {};
  for (const lang of langs) {
    add[lang] = {};
    for (const key of addedKeys) {
      add[lang][key] = lang === 'en' ? key : '';
    }
  }

  const report = {
    add,
    removed: removedKeys
  };

  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (!noOpen) {
    openFileInCursor(outputPath);
  }

  process.stdout.write(
    JSON.stringify(
      {
        outputPath,
        addKeysCount: addedKeys.length,
        removedKeysCount: removedKeys.length,
        langs,
        note: noOpen
          ? '已生成临时 JSON（未自动打开），本地文件无需提交。'
          : '已生成临时 JSON 并自动打开，本地文件无需提交。'
      },
      null,
      2
    )
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main();
}
