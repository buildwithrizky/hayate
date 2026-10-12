import { tauriInvoke } from "./api.js";

export async function fetchDirectoryItems(state, dirPath) {
  if (state.folderCache.has(dirPath)) {
    return state.folderCache.get(dirPath);
  }
  try {
    const data = await tauriInvoke("get_files", { path: dirPath });
    const items = Array.isArray(data) ? data : (data?.items || []);
    if (items.length > 0 || Array.isArray(data)) {
      state.folderCache.set(dirPath, items);
      return items;
    }
  } catch (e) {
    console.error("fetchDirectoryItems failed", e);
  }
  return [];
}

/**
 * Single-child directory compression (VS Code compact folders).
 * Compresses chains of single-folder directories into a single node.
 * ponytail: upgrade to support custom separator settings when user preferences added.
 */
export async function getCompactChain(state, item) {
  if (!item.isDirectory) return { displayParts: [item.name], finalItem: item, itemsInChain: [item] };

  let current = item;
  const displayParts = [item.name];
  const itemsInChain = [item];

  while (current.isDirectory) {
    const children = await fetchDirectoryItems(state, current.path);
    if (children.length === 1 && children[0].isDirectory) {
      current = children[0];
      displayParts.push(current.name);
      itemsInChain.push(current);
    } else {
      break;
    }
  }

  return { displayParts, finalItem: current, itemsInChain };
}
