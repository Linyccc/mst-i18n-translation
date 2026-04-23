/**
 * @description 应用翻译词条自动更新到各语言文件时会执行
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { applyArLrm } from './ar-lrm-postprocess.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function detectWorkspaceRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return process.cwd();
}

const workspaceRoot = detectWorkspaceRoot();
const localeRoot = path.join(workspaceRoot, 'src/locales');
const runtimeReportPath = path.join(skillDir, '.runtime/translation-collect.json');

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listLocaleLangs() {
  const entries = await fs.readdir(localeRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function collectMatchingFilesByBasename(baseDir, basename) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectMatchingFilesByBasename(fullPath, basename)));
      continue;
    }
    if (entry.isFile() && entry.name === basename) {
      found.push(fullPath);
    }
  }
  return found;
}

function toPrettyJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function isObjectRecord(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

export async function main() {
  const targetJsonFile = process.argv[2];
  if (!targetJsonFile) {
    throw new Error('请提供目标 json 文件名，例如: account.json');
  }
  if (!targetJsonFile.endsWith('.json')) {
    throw new Error(`目标文件名必须以 .json 结尾: ${targetJsonFile}`);
  }

  if (!(await pathExists(runtimeReportPath))) {
    throw new Error(`未找到收集结果文件: ${runtimeReportPath}`);
  }

  const reportRaw = await fs.readFile(runtimeReportPath, 'utf8');
  const report = JSON.parse(reportRaw);
  const add = report?.add ?? {};
  const removed = Array.isArray(report?.removed) ? report.removed : [];

  const langs = await listLocaleLangs();
  const matchedFiles = [];
  for (const lang of langs) {
    const langDir = path.join(localeRoot, lang);
    const hits = await collectMatchingFilesByBasename(langDir, targetJsonFile);
    for (const filePath of hits) {
      matchedFiles.push({ lang, filePath });
    }
  }

  let createdByDefault = false;
  if (matchedFiles.length === 0) {
    createdByDefault = true;
    for (const lang of langs) {
      matchedFiles.push({
        lang,
        filePath: path.join(localeRoot, lang, targetJsonFile)
      });
    }
  }

  let updatedFiles = 0;
  let addedCount = 0;
  let removedCount = 0;
  let skippedEmptyTranslations = 0;

  for (const { lang, filePath } of matchedFiles) {
    const exists = await pathExists(filePath);
    const raw = exists ? await fs.readFile(filePath, 'utf8') : '{}';
    const json = JSON.parse(raw);
    if (!isObjectRecord(json)) {
      continue;
    }

    let changed = false;
    const langAddMap = isObjectRecord(add[lang]) ? add[lang] : {};

    for (const [key, value] of Object.entries(langAddMap)) {
      let val = typeof value === 'string' ? value : '';
      if (lang !== 'en' && !val.trim()) {
        skippedEmptyTranslations += 1;
        continue;
      }
      if (lang === 'ar') {
        val = applyArLrm(val, key);
      }
      if (json[key] !== val) {
        json[key] = val;
        addedCount += 1;
        changed = true;
      }
    }

    for (const key of removed) {
      if (Object.prototype.hasOwnProperty.call(json, key)) {
        delete json[key];
        removedCount += 1;
        changed = true;
      }
    }

    if (changed) {
      await fs.writeFile(filePath, toPrettyJson(json), 'utf8');
      updatedFiles += 1;
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        targetJsonFile,
        matched: createdByDefault ? 0 : matchedFiles.length,
        createdByDefault,
        updatedFiles,
        addedCount,
        removedCount,
        skippedEmptyTranslations,
        note:
          createdByDefault
            ? `未匹配到现有 ${targetJsonFile}，已在各语言目录创建并写入。`
            : skippedEmptyTranslations > 0
              ? '已应用 locale 更新；部分非 en 语言因翻译为空已跳过。'
              : '已应用 locale 更新。'
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
