/**
 * File Nesting definitions and tree-nesting transform logic.
 * Patterns:
 * - package.json: package-lock.json, pnpm-lock.yaml, bun.lockb, yarn.lock
 * - Cargo.toml: Cargo.lock
 * - *.ts: *.js, *.d.ts, *.js.map, *.d.ts.map
 * - *.tsx: *.jsx, *.css, *.scss, *.module.css
 * - .env: .env.*, .env.local, .env.development, .env.production
 * ponytail: upgrade to configurable user patterns via settings JSON.
 */

export const NESTING_PATTERNS = [
  {
    parentMatch: (name) => name === "package.json",
    childMatch: (name) =>
      ["package-lock.json", "pnpm-lock.yaml", "bun.lockb", "yarn.lock"].includes(name)
  },
  {
    parentMatch: (name) => name === "Cargo.toml",
    childMatch: (name) => name === "Cargo.lock"
  },
  {
    parentMatch: (name) => name === ".env",
    childMatch: (name) => name.startsWith(".env.")
  },
  {
    parentMatch: (name) => /\.ts$/i.test(name) && !name.endsWith(".d.ts"),
    childMatch: (name, parentName) => {
      const base = parentName.slice(0, -3);
      return (
        name === `${base}.js` ||
        name === `${base}.d.ts` ||
        name === `${base}.js.map` ||
        name === `${base}.d.ts.map`
      );
    }
  },
  {
    parentMatch: (name) => /\.tsx$/i.test(name),
    childMatch: (name, parentName) => {
      const base = parentName.slice(0, -4);
      return (
        name === `${base}.jsx` ||
        name === `${base}.css` ||
        name === `${base}.scss` ||
        name === `${base}.module.css`
      );
    }
  }
];

export function applyFileNesting(items) {
  if (!items || items.length === 0) return [];

  const fileItems = items.filter((it) => !it.isDirectory);
  const matchedChildPaths = new Set();
  const parentToChildren = new Map();

  for (const candidate of fileItems) {
    for (const rule of NESTING_PATTERNS) {
      if (rule.parentMatch(candidate.name)) {
        const nested = [];
        for (const child of fileItems) {
          if (child.path === candidate.path) continue;
          if (rule.childMatch(child.name, candidate.name)) {
            nested.push(child);
            matchedChildPaths.add(child.path);
          }
        }
        if (nested.length > 0) {
          const prev = parentToChildren.get(candidate.path) || [];
          parentToChildren.set(candidate.path, prev.concat(nested));
        }
      }
    }
  }

  const result = [];
  for (const item of items) {
    if (matchedChildPaths.has(item.path)) continue;
    if (parentToChildren.has(item.path)) {
      result.push({
        ...item,
        nestedChildren: parentToChildren.get(item.path)
      });
    } else {
      result.push(item);
    }
  }

  return result;
}
