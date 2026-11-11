/* Theme Credits (generated)
 * Project: Local Preview Sample
 * Author: Scott Zastrow
 * Description: Validated One Wall map and player spawns.
 * End Theme Credits
 */
import { validateMapDefinition } from "@multiplayer-game/theme-sdk";

export const sampleMap = validateMapDefinition({
  formatVersion: 1,
  id: "local-preview-sample",
  name: "One Wall",
  bounds: { width: 256, height: 192 },
  cellSize: 32,
  objects: [
    { id: "wall", typeId: "wall", position: { x: 128, y: 96 } }
  ],
  collisions: [
    {
      id: "wall-collision",
      objectId: "wall",
      shape: { type: "rect", width: 32, height: 96 }
    }
  ],
  spawns: [
    { id: "player-west", kind: "player", position: { x: 48, y: 80 }, radius: 8 },
    { id: "player-east", kind: "player", position: { x: 176, y: 80 }, radius: 8 }
  ]
});
