# Common Workflows

## Create a New Page

1. Create `src/<slug>.md`.
2. Add frontmatter only when needed (`title`, `theme`, `toc`).
3. Add charts/logic in fenced `js` blocks.
4. Run `npm run build`.

## Add a Data Loader

Use this template:

```js
import {csvFormat} from "d3-dsv";

const response = await fetch("https://example.com/data.json");
if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
const rows = await response.json();

process.stdout.write(csvFormat(rows));
```

Notes:
- Keep loader side effects limited to writing transformed output.
- Prefer stable output schemas so pages do not break unexpectedly.

## Use Components

- Create `src/components/<name>.js`.
- Export named functions, e.g. `export function wheelChart(data, {width, height} = {}) { ... }`.
- Import in page code blocks with relative imports.

## Debug Checklist

1. Run `npm run build` and read the first error.
2. Confirm referenced paths exist under `src/`.
3. Confirm loader output format matches page reader (`csv`, `json`, etc.).
4. Check `observablehq.config.js` for incorrect `root` or `pages` path entries.
5. Re-run with `npm run observable -- build --verbose` for extra detail.
