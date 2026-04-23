import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';

function detectWorkspaceRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return process.cwd();
}

const workspaceRoot = detectWorkspaceRoot();

function uniqSorted(arr) {
  return [...new Set(arr)].sort();
}

function stringLiteralText(node) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function extractKeysFromCode(code, filePath) {
  const isTsx = filePath.endsWith('.tsx');
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind);
  const keys = new Set();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isTCall =
        (ts.isIdentifier(callee) && callee.text === 't') ||
        (ts.isPropertyAccessExpression(callee) && callee.name?.text === 't');
      if (isTCall && node.arguments.length >= 1) {
        const key = stringLiteralText(node.arguments[0]);
        if (key) keys.add(key);
      }
    }
    function extractTransI18nKey(attributes, sf) {
      for (const attr of attributes?.properties ?? []) {
        if (!ts.isJsxAttribute(attr)) continue;
        const nameText = attr.name?.getText?.(sf) ?? (attr.name?.kind === ts.SyntaxKind.JsxIdentifier ? attr.name.text : null);
        if (nameText !== 'i18nKey') continue;
        const init = attr.initializer;
        if (init) {
          const key = stringLiteralText(init);
          if (key) keys.add(key);
          if (!key && ts.isJsxExpression(init) && init.expression) {
            const key2 = stringLiteralText(init.expression);
            if (key2) keys.add(key2);
          }
        }
      }
    }
    function isTransTag(tagNode, sf) {
      if (!tagNode) return false;
      const text = tagNode.getText?.(sf) ?? (tagNode.kind === ts.SyntaxKind.JsxIdentifier ? tagNode.text : null);
      return text === 'Trans';
    }
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      if (isTransTag(opening?.tagName, sourceFile)) {
        extractTransI18nKey(opening.attributes, sourceFile);
      }
    }
    if (ts.isJsxSelfClosingElement(node)) {
      if (isTransTag(node.tagName, sourceFile)) {
        extractTransI18nKey(node.attributes, sourceFile);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return keys;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function gitShow(ref, relPath) {
  const res = spawnSync('git', ['show', `${ref}:${relPath}`], { cwd: workspaceRoot, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout?.toString() ?? null;
}

export async function extractKeysFromGitRef(relFilePath, ref) {
  const content = gitShow(ref, relFilePath);
  if (content == null) return new Set();
  return extractKeysFromCode(content, relFilePath);
}

export async function extractKeysFromWorktree(relFilePath) {
  const abs = path.join(workspaceRoot, relFilePath);
  const content = await readFileIfExists(abs);
  if (content == null) return new Set();
  return extractKeysFromCode(content, relFilePath);
}

export function diffKeys(oldKeys, newKeys) {
  const removed = [...oldKeys].filter((k) => !newKeys.has(k));
  const added = [...newKeys].filter((k) => !oldKeys.has(k));
  return { added: uniqSorted(added), removed: uniqSorted(removed) };
}
