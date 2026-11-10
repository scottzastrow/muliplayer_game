export const NPC_COLOR = "#ed6b61";
// Leave the red sector to enemies, including at the full 32-player roster.
export const PLAYER_COLORS: readonly string[] = Object.freeze(
  Array.from({ length: 32 }, (_, index) =>
    `hsl(${Math.round(40 + ((index * 13) % 32) * 280 / 31)} 78% 58%)`)
);

export function resolvePlayerColors(
  players: readonly { readonly accountId: string; readonly color?: string | undefined }[]
): ReadonlyMap<string, string> {
  if (players.length > PLAYER_COLORS.length) {
    throw new RangeError("The default theme supports at most 32 distinct player colors.");
  }
  const colors = new Map<string, string>();
  const used = new Set<string>();
  const ordered = [...players].sort((a, b) => a.accountId < b.accountId ? -1
    : a.accountId > b.accountId ? 1 : 0);
  for (const player of ordered) {
    if (player.color && PLAYER_COLORS.includes(player.color) && !used.has(player.color)) {
      colors.set(player.accountId, player.color);
      used.add(player.color);
    }
  }
  for (const player of ordered) {
    if (colors.has(player.accountId)) continue;
    const color = PLAYER_COLORS.find(candidate => !used.has(candidate));
    if (!color) throw new Error("No distinct player color is available.");
    colors.set(player.accountId, color);
    used.add(color);
  }
  return colors;
}
