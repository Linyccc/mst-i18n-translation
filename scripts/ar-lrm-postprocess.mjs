import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const outputPath = path.join(skillDir, '.runtime', 'translation-collect.json');

const LRM = '\u200E';

// 阿拉伯-印度数字 ٠١٢٣٤٥٦٧٨٩ -> 0-9
const ARABIC_TO_WESTERN = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toWesternDigits(s) {
  return s.replace(/[٠-٩]/g, (c) => ARABIC_TO_WESTERN[c] ?? c);
}

function phoneToArRegex(phoneWestern) {
  let pattern = '';
  for (const c of phoneWestern) {
    if (/\d/.test(c)) {
      const ar = Object.entries(ARABIC_TO_WESTERN).find(([, w]) => w === c)?.[0] ?? c;
      pattern += `[${escapeRegExp(c)}${ar}]`;
    } else {
      pattern += escapeRegExp(c);
    }
  }
  return new RegExp(pattern, 'g');
}

function extractLtrCandidatesFromKey(key) {
  const candidates = [];
  const plusTokens = key.match(/[A-Za-z0-9][A-Za-z0-9\s_-]*\+[A-Za-z0-9]*/g);
  if (plusTokens) plusTokens.forEach((t) => candidates.push({ token: t.trim(), isPhone: false }));
  const productNames = key.match(/\b(Foxit(?:\s+PDF\s+Editor(?:\s*\+|\s+Suite|\s+Pro\+?)?|\s+eSign)?|PDF\s+Editor(?:\s*\+|\s+Suite|\s+Pro\+?)?|PDF\s+SDK|PDF\s+IFilter|PDF\s+Compressor|eSign(?:\s+(?:Business|Essentials))?|AI\s+Assistant)(?!\w)/g);
  if (productNames) productNames.forEach((t) => candidates.push({ token: t.trim(), isPhone: false }));
  const phoneTokens = key.match(/\+?\d[\d\s\-()]{5,}\d/g);
  if (phoneTokens) phoneTokens.forEach((t) => candidates.push({ token: t.trim(), isPhone: true }));
  return candidates.filter((x) => x.token);
}

export function applyArLrm(arValue, key) {
  if (typeof arValue !== 'string') return arValue;
  const items = extractLtrCandidatesFromKey(key);
  let result = arValue;
  for (const { token, isPhone } of items) {
    if (!token) continue;
    if (isPhone) {
      const arRegex = phoneToArRegex(token);
      const notFollowedByLrm = new RegExp(`(${arRegex.source})(?!${escapeRegExp(LRM)})`, 'g');
      result = result.replace(notFollowedByLrm, (match) => toWesternDigits(match) + LRM);
    } else {
      const re = new RegExp(`${escapeRegExp(token)}(?!${escapeRegExp(LRM)})`, 'g');
      result = result.replace(re, `${token}${LRM}`);
    }
  }
  return result;
}

export async function postprocessJson(jsonPath = outputPath) {
  const raw = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const arAdd = data?.add?.ar;
  if (!arAdd || typeof arAdd !== 'object') return { changed: 0 };
  let changed = 0;
  for (const [key, value] of Object.entries(arAdd)) {
    const next = applyArLrm(value, key);
    if (next !== value) {
      arAdd[key] = next;
      changed++;
    }
  }
  if (changed > 0) {
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
  return { changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const pathArg = process.argv[2] || outputPath;
  postprocessJson(pathArg).then((r) => process.stdout.write(JSON.stringify(r, null, 2)));
}
