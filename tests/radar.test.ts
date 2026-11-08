import { describe, expect, it } from "vitest";
import {
  drawRadar,
  RadarViewSchema,
  type RadarRenderOptions
} from "@multiplayer-game/theme-sdk";

function renderingContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly arcs: { x: number; y: number; radius: number; color: string }[];
  readonly labels: string[];
  readonly rectangles: { x: number; y: number; width: number; height: number; clipped: boolean }[];
  readonly paths: { x: number; y: number }[][];
} {
  let fillStyle = "";
  const arcs: { x: number; y: number; radius: number; color: string }[] = [];
  const labels: string[] = [];
  const rectangles: { x: number; y: number; width: number; height: number; clipped: boolean }[] = [];
  const paths: { x: number; y: number }[][] = [];
  let clipped = false;
  let path: { x: number; y: number }[] = [];
  const context = {
    get fillStyle() { return fillStyle; },
    set fillStyle(value: string) { fillStyle = value; },
    save() {},
    restore() { clipped = false; },
    beginPath() { path = []; },
    closePath() { paths.push(path); },
    arc(x: number, y: number, radius: number) {
      arcs.push({ x, y, radius, color: fillStyle });
    },
    fill() {},
    clip() { clipped = true; },
    stroke() {},
    moveTo(x: number, y: number) { path.push({ x, y }); },
    lineTo(x: number, y: number) { path.push({ x, y }); },
    fillRect(x: number, y: number, width: number, height: number) {
      rectangles.push({ x, y, width, height, clipped });
    },
    fillText(text: string) { labels.push(text); },
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set font(_value: string) {},
    set textAlign(_value: CanvasTextAlign) {},
    set textBaseline(_value: CanvasTextBaseline) {}
  } as unknown as CanvasRenderingContext2D;
  return { context, arcs, labels, rectangles, paths };
}

describe("shared radar SDK", () => {
  it("validates game-defined categories and bounded marker data", () => {
    const view = RadarViewSchema.parse({
      categories: ["objective", "resource"],
      markers: [
        { id: "door-1", category: "objective", position: { x: 1, y: 2 } },
        { id: "ore-1", category: "resource", position: { x: 3, y: 4 } }
      ]
    });
    expect(view.markers).toHaveLength(2);
    expect(RadarViewSchema.safeParse({
      categories: ["objective"],
      markers: [{ id: "door-1", category: "enemy", position: { x: 1, y: 2 } }]
    }).success).toBe(false);
    expect(RadarViewSchema.safeParse({
      categories: ["objective"],
      markers: [{ id: "door-1", category: "objective", position: { x: Infinity, y: 2 } }]
    }).success).toBe(false);
  });

  it("renders relative positions, clamps distant markers to the rim and shows north/facing", () => {
    const radar = RadarViewSchema.parse({
      categories: ["objective"],
      markers: [
        { id: "near", category: "objective", position: { x: 50, y: 100 } },
        { id: "far", category: "objective", position: { x: 400, y: 100 } }
      ]
    });
    const { context, arcs, labels } = renderingContext();
    const options: RadarRenderOptions = {
      x: 100,
      y: 80,
      radius: 50,
      range: 100,
      center: { x: 0, y: 100 },
      facing: { x: 1, y: 0 },
      markerColors: { objective: "#00ff00" },
      anchorColor: "#ffffff"
    };

    drawRadar(context, radar, options);

    const markers = arcs.filter((arc) => arc.color === "#00ff00");
    expect(markers).toEqual([
      { x: 122.5, y: 80, radius: 3, color: "#00ff00" },
      { x: 145, y: 80, radius: 3, color: "#00ff00" }
    ]);
    expect(arcs).toContainEqual({ x: 100, y: 80, radius: 4, color: "#ffffff" });
    expect(arcs).toContainEqual({ x: 112, y: 80, radius: 2, color: "#ffffff" });
    expect(labels).toContain("N");
  });

  it("fails explicitly when a tracked marker has no configured color", () => {
    const radar = RadarViewSchema.parse({
      categories: ["objective"],
      markers: [{ id: "door-1", category: "objective", position: { x: 1, y: 2 } }]
    });
    const { context } = renderingContext();
    expect(() => drawRadar(context, radar, {
      x: 0, y: 0, radius: 10, range: 10, center: { x: 0, y: 0 }, markerColors: {}
    })).toThrow(/no marker color/);
  });

  it("filters display only, uses marker colors and draws rim diamonds and unclamped clipped footprints", () => {
    const view = RadarViewSchema.parse({
      categories: ["friend", "resource", "geometry"],
      markers: [
        { id: "friend", category: "friend", position: { x: 0, y: -50 } },
        { id: "resource", category: "resource", position: { x: 1000, y: 0 } },
        { id: "wall", category: "geometry", position: { x: 200, y: 0 },
          footprint: { width: 32, height: 64 } }
      ]
    });
    const original = structuredClone(view);
    const { context, arcs, rectangles, paths } = renderingContext();
    const options: RadarRenderOptions = {
      x: 100, y: 80, radius: 50, range: 100, center: { x: 0, y: 0 },
      markerColors: { friend: "#ffff00", resource: "#ffa64d", geometry: "#344a60" },
      markerColorOverrides: { friend: "#00ff00" },
      markerShapes: { resource: "diamond", geometry: "footprint" }
    };
    drawRadar(context, view, options);
    expect(arcs).toContainEqual({ x: 100, y: 57.5, radius: 3, color: "#00ff00" });
    expect(paths).toContainEqual([
      { x: 145, y: 77 }, { x: 148, y: 80 }, { x: 145, y: 83 }, { x: 142, y: 80 }
    ]);
    expect(rectangles).toEqual([{ x: 182.8, y: 65.6, width: 14.4, height: 28.8, clipped: true }]);
    arcs.length = 0;
    rectangles.length = 0;
    paths.length = 0;
    drawRadar(context, view, { ...options, enabledCategories: [] });
    expect(arcs.filter(arc => arc.radius === 3)).toEqual([]);
    expect(rectangles).toEqual([]);
    expect(paths).toEqual([]);
    expect(view).toEqual(original);
  });

  it("rejects duplicate IDs/categories, invalid footprints and over-budget views", () => {
    const marker = { id: "wall", category: "geometry", position: { x: 0, y: 0 } };
    for (const view of [
      { categories: ["geometry", "geometry"], markers: [] },
      { categories: ["geometry"], markers: [marker, marker] },
      { categories: ["geometry"], markers: [{ ...marker, footprint: { width: 0, height: 32 } }] },
      { categories: ["geometry"], markers: [{ ...marker, footprint: { width: 32, height: Infinity } }] },
      { categories: ["geometry"], markers: Array.from({ length: 6401 }, (_, id) => ({ ...marker, id: `${id}` })) }
    ]) expect(RadarViewSchema.safeParse(view).success).toBe(false);
  });
});
