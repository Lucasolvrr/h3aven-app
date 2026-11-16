// Folder colours. A folder stores the `id`; the hue and saturation drive the
// frosted look in CSS (see .folder in components.css).

export const FOLDER_COLORS = [
  { id: 'stone', label: 'Stone', h: 40, s: 5, d: 6 },
  { id: 'red', label: 'Red', h: 2, s: 52 },
  { id: 'orange', label: 'Orange', h: 22, s: 58, d: 6 },
  { id: 'amber', label: 'Amber', h: 40, s: 56, d: 14 },
  { id: 'green', label: 'Green', h: 145, s: 34, d: 12 },
  { id: 'teal', label: 'Teal', h: 178, s: 40, d: 14 },
  { id: 'blue', label: 'Blue', h: 214, s: 54 },
  { id: 'indigo', label: 'Indigo', h: 238, s: 50 },
  { id: 'violet', label: 'Violet', h: 258, s: 52 },
  { id: 'pink', label: 'Pink', h: 328, s: 46 },
];

function hashOf(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** The folder's colour; one without a saved colour gets a stable pick from its id. */
export function folderColor(folder) {
  return FOLDER_COLORS.find((color) => color.id === folder?.color) || FOLDER_COLORS[hashOf(folder?.id || '') % FOLDER_COLORS.length];
}

/** A random colour for a new folder, avoiding the ones its siblings already use when possible. */
export function randomFolderColor(siblings = []) {
  const used = new Set(siblings.map((folder) => folderColor(folder).id));
  const free = FOLDER_COLORS.filter((color) => !used.has(color.id));
  const pool = free.length ? free : FOLDER_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Sidebar tiles: the same hues, without the near-grey Stone, so every place
// in the nav gets a clear colour of its own.
const TILE_COLORS = FOLDER_COLORS.filter((color) => color.id !== 'stone');

// Categories take these in sidebar order, so neighbours never share a colour
// and none repeats Favorites (pink) or Library (violet).
const CATEGORY_TILES = ['blue', 'orange', 'green', 'amber', 'teal', 'indigo', 'red'];

/** The tile colour of the category at this position in the sidebar. */
export const tileColor = (index) => tileOf(CATEGORY_TILES[index % CATEGORY_TILES.length]);
export const tileOf = (id) => TILE_COLORS.find((color) => color.id === id);

/** Inline style that hands a colour to CSS. */
export const colorVars = (color) => `--fh:${color.h};--fs:${color.s}%;--fd:${color.d || 0}%`;
