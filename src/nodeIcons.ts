// Small bundled SVGs: diagram rendering never fetches icons from the network.
const paths: Record<string, string> = {
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.01M7 17h.01"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  network:
    '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  boxes:
    '<path d="m12 2 5 3v6l-5 3-5-3V5l5-3ZM7 5l5 3 5-3M12 8v6M7 11l-5 3v6l5 3 5-3v-6M2 14l5 3 5-3M7 17v6M17 11l5 3v6l-5 3-5-3M12 14l5 3 5-3M17 17v6"/>',
  building: '<rect x="5" y="3" width="14" height="19" rx="2"/><path d="M9 22v-4h6v4M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1"/>',
  flask: '<path d="M9 3h6M10 3v7l-6 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-9V3M8 15h8"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10"/>',
};
export const iconMarkup = (name: string) => Object.hasOwn(paths, name) ? paths[name] : paths.box;
export function nodeIcon(name: string, color: string): string {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#aaaabb";
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(name)}</svg>`)}`;
}
