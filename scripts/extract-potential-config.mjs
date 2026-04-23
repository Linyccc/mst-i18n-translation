/**
 * @description 从代码中抽取未使用 t/Trans 包裹的潜在配置化字符串
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';

function detectWorkspaceRoot() {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout?.trim()) return res.stdout.trim();
  return process.cwd();
}

const workspaceRoot = detectWorkspaceRoot();

function stringLiteralText(node) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** 常见「拼 class」工具：其字符串实参视为样式而非文案 */
const CLASS_MERGE_CALLEES = new Set(['classNames', 'clsx', 'cn', 'cva', 'twMerge']);

function getSimpleCalleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }
  return null;
}

/**
 * 明显不是面向用户的英文句子：路由、资源路径、Tailwind、accept 扩展名列表等
 * 用于降低「潜在配置文案」对非句子的误判
 */
function isClearlyTechnicalOrNonCopyString(raw) {
  const t = raw.trim();
  if (!t) return true;

  // tel / mailto 等非页面文案
  if (/^(tel|mailto|sms|fax):/i.test(t)) return true;

  // 相对路径、典型静态资源目录
  if (/^\.\.?\//.test(t)) return true;
  if (/\/public\/|\/assets\/|\/node_modules\//i.test(t)) return true;
  if (/\.(ttf|woff2?|eot|otf|png|jpe?g|gif|webp|svg|ico|mp4|webm|pdf|zip)(\?|#|$)/i.test(t)) return true;

  // 整串为站点路径（无空格），如 /account、/ai/chat-pdf/
  if (!/\s/.test(t) && /^\/[\w./-]+\/?$/.test(t)) return true;

  // input accept：doc,docx / pdf,png,...
  if (/^[a-z0-9]{1,12}(,[a-z0-9]{1,12})+$/i.test(t)) return true;

  // Tailwind 任意变体 / 子选择器
  if (t.includes('[&')) return true;
  // arbitrary: ]:text-  ]:!stroke-
  if (/\]:\!?[a-z-]/i.test(t)) return true;
  // 工具类 + 任意值：size-[1.25rem]、top-[3.875rem]、border-[#fff]
  if (/\w+-\[[^\]]{1,100}\]/.test(t)) return true;

  // 断点/状态前缀（含项目里可能出现的 xm 等），如 md:、hover:!、max-md:[
  if (
    /(?:^|[\s"'`])(?:sm|md|lg|xl|2xl|3xl|xm|max-md|min-md|max-lg|min-lg|hover|focus|focus-visible|active|disabled|group-hover|peer-focus|aria-[a-z0-9-]+):(?:!|\[)?/i.test(
      t
    )
  ) {
    return true;
  }

  // 多段空格分隔且半数以上像工具 token（含 - : [ ] # 数字等），整串更像 class 串
  const segments = t.split(/\s+/).filter(Boolean);
  if (segments.length >= 5) {
    const techy = segments.filter((s) => /[-:[\]!#%]|\d/.test(s)).length;
    if (techy >= Math.ceil(segments.length * 0.5)) return true;
  }

  return false;
}

/** 判断字符串是否像需翻译的自然语言（过滤 className、URL、ID 等） */
function isLikelyEnglishPhrase(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  // 该收集器主要面向英文主站文案，先排除 CJK 混排与无字母内容
  if (/[\u4e00-\u9fff]/.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;

  // 排除常见 key/变量名：camelCase / snake_case / kebab-case / 单词标识符
  if (/^[a-z]+([A-Z][a-z0-9]+)+$/.test(normalized)) return false;
  if (/^[a-z0-9_]+$/i.test(normalized) && !normalized.includes(' ')) return false;
  if (/^[a-z0-9-]+$/i.test(normalized) && !normalized.includes(' ')) return false;

  const words = normalized.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  if (words.length === 0) return false;

  // 单词太短通常是缩写/占位值，不视为可翻译句子
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 4) return false;
    // 单段全大写/数字混合多为电话、SKU、常量，而非自然句
    if (/^[A-Z0-9-]+$/.test(w) && /[A-Z]/.test(w) && /\d/.test(w)) return false;
    return true;
  }

  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  const nonSpaceChars = normalized.replace(/\s/g, '').length;
  if (nonSpaceChars === 0) return false;

  // 英文字母占比太低，多为代码片段或符号拼接，不作为词条
  return letters / nonSpaceChars >= 0.35;
}

function looksLikeTranslatable(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 2) return false;
  if (isClearlyTechnicalOrNonCopyString(t)) return false;
  if (/^[\d\s\-_.,:;\/\\]+$/.test(t)) return false; // 纯数字/符号
  if (/^[a-z-]+$/.test(t) && t.length < 4) return false; // 短标识符如 mm yy
  if (/^https?:\/\//i.test(t)) return false;
  if (/^[.#]?[a-zA-Z_-][\w-]*$/.test(t) && t.length < 15) return false; // 类名/ID
  return isLikelyEnglishPhrase(t);
}

function isTCallExpression(expr) {
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  return (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name?.text === 't');
}

/** 判断 target 是否位于 root 子树中（含 root 自身） */
function nodeContainsDescendant(root, target) {
  if (root === target) return true;
  let found = false;
  function walk(n) {
    if (found) return;
    if (n === target) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(root);
  return found;
}

/**
 * 字符串是否作为 classNames/clsx 等调用的实参出现（含 cond && '...'、嵌套表达式）
 */
function isStringLiteralUnderClassMergeCall(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const calleeName = getSimpleCalleeName(current.expression);
      if (calleeName && CLASS_MERGE_CALLEES.has(calleeName)) {
        for (const arg of current.arguments) {
          if (nodeContainsDescendant(arg, node)) return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}

function shouldSkipStringLiteral(node, sourceFile) {
  const parent = node.parent;
  if (!parent) return false;

  // 跳过 t('xxx') 参数
  if (ts.isCallExpression(parent) && parent.arguments.includes(node) && isTCallExpression(parent)) {
    return true;
  }

  // JSX 属性名在 TS AST 中多为 Identifier，少数为 JsxIdentifier；统一用 getText
  if (ts.isJsxAttribute(parent) && parent.name) {
    const attrName = parent.name.getText(sourceFile);
    if (attrName === 'i18nKey') return true;
    if (attrName === 'className' || attrName === 'class') return true;
  }

  // 跳过 classNames('...') / clsx('...') 等（含实参内的二元、三元表达式）
  if (isStringLiteralUnderClassMergeCall(node)) return true;

  // 跳过 import/export 路径
  if (
    (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node)
  ) {
    return true;
  }

  // 跳过对象 key
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return true;
  }

  // 跳过文件顶部指令，如 "use client"
  if (ts.isExpressionStatement(parent) && parent.expression === node) {
    const isPrologue = sourceFile.statements.includes(parent);
    if (isPrologue) return true;
  }

  return false;
}

/**
 * 从代码中抽取未使用 t/Trans 包裹的潜在配置化字符串
 * 轻量策略：抽取引号包裹的字符串与 JSX 文本，再用 looksLikeTranslatable 过滤
 * @returns {Array<{ file: string, line: number, value: string, context: string }>}
 */
function extractFromCode(code, filePath) {
  const isTsx = filePath.endsWith('.tsx');
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind);
  const results = [];
  const seen = new Set();

  function getLineAndChar(pos) {
    const lineChar = sourceFile.getLineAndCharacterOfPosition(pos);
    return lineChar.line + 1;
  }

  function pushCandidate(node, value, context) {
    if (!value || !looksLikeTranslatable(value)) return;
    const line = getLineAndChar(node.getStart());
    const dedupeKey = `${line}:${value}:${context}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    results.push({
      file: filePath,
      line,
      value,
      context
    });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = node.text?.trim();
      if (text) pushCandidate(node, text, 'jsx-text');
      ts.forEachChild(node, visit);
      return;
    }
    // 统一抽取字符串字面量（'...' / "..." / `...`），跳过已 i18n 包裹与明显非文案场景
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!shouldSkipStringLiteral(node, sourceFile)) {
        const literalText = stringLiteralText(node);
        if (literalText) pushCandidate(node, literalText, 'string-literal');
      }
      ts.forEachChild(node, visit);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
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

export async function extractFromGitRef(relFilePath, ref) {
  const content = gitShow(ref, relFilePath);
  if (content == null) return [];
  return extractFromCode(content, relFilePath);
}

export async function extractFromWorktree(relFilePath) {
  const abs = path.join(workspaceRoot, relFilePath);
  const content = await readFileIfExists(abs);
  if (content == null) return [];
  return extractFromCode(content, relFilePath);
}

/** 对比两份结果，返回新增的潜在配置化词条（以 file+line+value 为 key 去重） */
export function diffPotentialConfig(oldList, newList) {
  const key = (r) => `${r.file}:${r.line}:${r.value}`;
  const oldSet = new Set(oldList.map(key));
  return newList.filter((r) => !oldSet.has(key(r)));
}

/**
 * 对比两份结果，返回潜在配置化词条的移除项（按 value 维度）
 * 说明：removed 更关心文案是否消失，而不是行号是否变化。
 */
export function diffPotentialConfigRemoved(oldList, newList) {
  const oldValues = new Set(oldList.map((r) => r.value).filter(Boolean));
  const newValues = new Set(newList.map((r) => r.value).filter(Boolean));
  return [...oldValues].filter((value) => !newValues.has(value)).sort();
}

/**
 * 判断某个文案是否仍在 src 下的 ts/tsx 文件中被引用。
 * 只要仍有引用，就不应进入 removed。
 */
export function isValueReferencedInSourceTree(value) {
  if (!value || typeof value !== 'string') return false;
  const targetDir = path.join(workspaceRoot, 'src');
  const res = spawnSync(
    'rg',
    ['-F', '-g', '*.ts', '-g', '*.tsx', '--files-with-matches', '--', value, targetDir],
    { cwd: workspaceRoot, encoding: 'utf8' }
  );
  return res.status === 0;
}
