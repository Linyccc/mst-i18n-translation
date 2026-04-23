---
name: mst-i18n-translation
description: Detect i18n key changes (t(), <Trans i18nKey>) and potential untranslated strings in the current git branch diff for react-i18next projects. Outputs a structured JSON with added keys (with AI-translated values for each locale) and removed keys. Use when the user asks to collect i18n translations, run translation diff, check for missing i18n keys, or mentions "mst-i18n-translation".
---

# i18n Translation Collect

Detect i18n key changes in the current git branch and generate a translation report JSON with AI-powered translations for all configured locales.

## Prerequisites

- **Git** repository with a clean HEAD (uses `git diff` to detect changes)
- **Node.js** 18+
- **TypeScript** npm package installed in the project (`import * as ts from 'typescript'`)
- **ripgrep** (`rg`) installed on the system
- **react-i18next** project structure with `src/locales/<lang>/*.json` locale files

## Modes

### Default Mode (collect + translate only)

Trigger: user runs the skill without extra arguments.

1. Execute: `node "<skill-dir>/scripts/run.mjs"`
2. Read the generated `.runtime/translation-collect.json`
3. For every non-`en` language in `add`, translate the English values into the target language and write back to the JSON
4. Validate no empty values remain, then open the result file in the editor

### Apply Mode (collect + translate + write to locale files)

Trigger: user provides a target JSON filename (e.g. `account.json`).

1. Execute: `node "<skill-dir>/scripts/run.mjs" --no-open`
2. Read `.runtime/translation-collect.json`
3. Translate all non-`en` empty values and write back
4. Execute: `node "<skill-dir>/scripts/apply-locale-updates.mjs" "<target-filename>"`
   - Matches `<target-filename>` under `src/locales/<lang>/` (recursive)
   - `add`: inserts or overwrites keys in matched files
   - `removed`: deletes keys present in the matched files
   - If no matching file exists, creates `src/locales/<lang>/<target-filename>` for each language

## Output JSON Structure

```json
{
  "add": {
    "en": { "key1": "English text", "key2": "Another text" },
    "de": { "key1": "", "key2": "" },
    "ja": { "key1": "", "key2": "" }
  },
  "removed": ["obsolete.key1", "obsolete.key2"]
}
```

- `add` — new keys per locale; `en` carries the original text, other languages are empty placeholders for the agent to fill via translation
- `removed` — keys that no longer appear in source and can be pruned from locale files

The `.runtime/` directory is ephemeral (gitignored) and should not be committed.

## Translation Quality Requirements

When filling translations, follow these rules:

1. **Professional and natural** — produce fluent, publication-ready translations; avoid word-for-word calques
2. **Accurate terminology** — use industry-standard terms in the target language (SaaS, PDF, e-signature, etc.)
3. **Localized expression** — adapt phrasing, honorifics, and word order to the target locale's conventions
4. **Preserve brand / product names in English** — the following names must NEVER be translated; embed them as-is in the translated sentence:
   - **Brand**: `Foxit` and all official product line names
   - **Product lines** (including suffix/symbol variants):
     - `Foxit PDF Editor`, `Foxit eSign`, `Foxit PDF Editor+`, etc.
     - `PDF Editor`, `PDF Editor+`, `PDF Editor Suite`, `PDF Editor Pro`, `PDF Editor Pro+`
     - `PDF SDK`, `PDF IFilter`, `PDF Compressor`
     - `eSign Business`, `eSign Essentials`
     - `AI Assistant` (Foxit feature name)
   - **Approach**: embed the English name directly in the translated sentence; add prepositions/particles around the name per target language grammar — do NOT transliterate or translate the name itself

## What the Scripts Detect

| Category                     | How                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **i18n keys**                | `t('...')` calls and `<Trans i18nKey="...">` JSX usage via TypeScript AST                                                                            |
| **Potential config strings** | String literals and JSX text not wrapped by `t`/`Trans`, filtered by heuristics (skips class names, URLs, routes, Tailwind utilities, imports, etc.) |
| **Removed keys**             | Keys present in HEAD but absent in the working tree; config strings confirmed unreferenced via `rg`                                                  |

## Scripts Reference

| Script                                 | Purpose                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `scripts/run.mjs`                      | Entry point — collects changed files, extracts keys, writes `.runtime/translation-collect.json` |
| `scripts/apply-locale-updates.mjs`     | Applies `add`/`removed` from the report into the project's `src/locales/**` JSON files          |
| `scripts/collect-changed-files.mjs`    | Lists `src/**/*.ts(x)` files changed vs HEAD (staged + unstaged + untracked)                    |
| `scripts/extract-i18n-keys.mjs`        | Extracts `t()` / `<Trans>` keys from TS/TSX via TypeScript compiler API                         |
| `scripts/extract-potential-config.mjs` | Extracts untranslated string literals with natural-language heuristics                          |
| `scripts/ar-lrm-postprocess.mjs`       | Inserts LRM marks for Arabic locale around LTR tokens (product names, phone numbers)            |
