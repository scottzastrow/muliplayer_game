import { z } from "zod";
import type { Point2 } from "./index.js";

const RadarCategorySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const DEFAULT_HIGHLIGHT_CENTER_RADIUS = 4;
const DEFAULT_HIGHLIGHT_PULSE_RADIUS = 14;
const RadarPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
}).strict();

export const RadarMarkerSchema = z.object({
  id: z.string().min(1).max(128),
  category: RadarCategorySchema,
  position: RadarPointSchema,
  footprint: z.object({
    width: z.number().finite().positive().max(2048),
    height: z.number().finite().positive().max(2048)
  }).strict().optional()
}).strict();

export const RadarViewSchema = z.object({
  categories: z.array(RadarCategorySchema).max(64),
  markers: z.array(RadarMarkerSchema).max(6400)
}).strict().superRefine((view, context) => {
  const categories = new Set(view.categories);
  if (categories.size !== view.categories.length) {
    context.addIssue({
      code: "custom",
      path: ["categories"],
      message: "Radar categories must be unique."
    });
  }

  const markerIds = new Set<string>();
  view.markers.forEach((marker, index) => {
    if (!categories.has(marker.category)) {
      context.addIssue({
        code: "custom",
        path: ["markers", index, "category"],
        message: "Every radar marker must use a tracked category."
      });
    }
    if (markerIds.has(marker.id)) {
      context.addIssue({
        code: "custom",
        path: ["markers", index, "id"],
        message: "Radar marker IDs must be unique."
      });
    }
    markerIds.add(marker.id);
  });
});

export type RadarMarker = z.infer<typeof RadarMarkerSchema>;
export type RadarView = z.infer<typeof RadarViewSchema>;

/**
 * Emphasises one marker with a center dot and a ring. With a phase (0-1) the ring expands
 * from the dot and fades; without a phase a static halo is drawn (for reduced motion).
 */
export interface RadarMarkerHighlight {
  readonly color: string;
  readonly centerRadius?: number;
  readonly pulseRadius?: number;
  readonly phase?: number;
}

export interface RadarRenderOptions {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly range: number;
  readonly center: Point2;
  readonly facing?: Point2;
  readonly markerColors: Readonly<Record<string, string>>;
  readonly markerColorOverrides?: Readonly<Record<string, string>>;
  readonly markerShapes?: Readonly<Record<string, "dot" | "diamond" | "footprint">>;
  readonly markerHighlights?: Readonly<Record<string, RadarMarkerHighlight>>;
  readonly enabledCategories?: readonly string[];
  readonly anchorColor?: string;
  readonly backgroundColor?: string;
  readonly borderColor?: string;
}

export function drawRadar(
  context: CanvasRenderingContext2D,
  view: Readonly<RadarView>,
  options: Readonly<RadarRenderOptions>
): void {
  const values = [options.x, options.y, options.radius, options.range,
    options.center.x, options.center.y];
  if (options.facing) values.push(options.facing.x, options.facing.y);
  if (!values.every(Number.isFinite) || options.radius <= 0 || options.range <= 0) {
    throw new RangeError("Radar dimensions, range and coordinates must be finite and positive.");
  }
  for (const marker of view.markers) {
    if (!Number.isFinite(marker.position.x) || !Number.isFinite(marker.position.y)) {
      throw new TypeError(`Radar marker ${marker.id} must have finite coordinates.`);
    }
    if (!options.markerColors[marker.category]) {
      throw new RangeError(`Radar category ${marker.category} has no marker color.`);
    }
    if (options.markerShapes?.[marker.category] === "footprint" &&
        (!marker.footprint || ![marker.footprint.width, marker.footprint.height]
          .every(value => Number.isFinite(value) && value > 0))) {
      throw new TypeError(`Radar marker ${marker.id} must have a positive finite footprint.`);
    }
  }
  for (const [id, highlight] of Object.entries(options.markerHighlights ?? {})) {
    const centerRadius = highlight.centerRadius ?? DEFAULT_HIGHLIGHT_CENTER_RADIUS;
    const pulseRadius = highlight.pulseRadius ?? DEFAULT_HIGHLIGHT_PULSE_RADIUS;
    if (!highlight.color || !Number.isFinite(centerRadius) || centerRadius <= 0 ||
        !Number.isFinite(pulseRadius) || pulseRadius <= centerRadius ||
        (highlight.phase !== undefined &&
          (!Number.isFinite(highlight.phase) || highlight.phase < 0 || highlight.phase > 1))) {
      throw new RangeError(
        `Radar highlight ${id} needs a color, positive center radius, larger pulse radius and phase 0-1.`
      );
    }
  }

  const markerRadius = 3;
  const edge = Math.max(0, options.radius - markerRadius - 2);
  context.save();
  context.beginPath();
  context.arc(options.x, options.y, options.radius, 0, Math.PI * 2);
  context.fillStyle = options.backgroundColor ?? "#101824";
  context.fill();
  context.clip();

  context.strokeStyle = "rgba(219, 231, 242, 0.32)";
  context.lineWidth = 1;
  for (const fraction of [0.5, 1]) {
    context.beginPath();
    context.arc(options.x, options.y, options.radius * fraction, 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(options.x - options.radius, options.y);
  context.lineTo(options.x + options.radius, options.y);
  context.moveTo(options.x, options.y - options.radius);
  context.lineTo(options.x, options.y + options.radius);
  context.stroke();

  const enabled = options.enabledCategories ? new Set(options.enabledCategories) : undefined;
  // Footprints are drawn first so they cannot obscure point markers.
  const markers = view.markers.filter(marker => !enabled || enabled.has(marker.category));
  const highlighted: { readonly x: number; readonly y: number; readonly highlight: RadarMarkerHighlight }[] = [];
  for (const marker of [...markers.filter(item => options.markerShapes?.[item.category] === "footprint"),
    ...markers.filter(item => options.markerShapes?.[item.category] !== "footprint")]) {
    const dx = marker.position.x - options.center.x;
    const dy = marker.position.y - options.center.y;
    const shape = options.markerShapes?.[marker.category] ?? "dot";
    context.fillStyle = options.markerColorOverrides?.[marker.id] ??
      options.markerColors[marker.category]!;
    if (shape === "footprint") {
      const scale = edge / options.range;
      const footprint = marker.footprint!;
      context.fillRect(
        options.x + (dx - footprint.width / 2) * scale,
        options.y + (dy - footprint.height / 2) * scale,
        footprint.width * scale,
        footprint.height * scale
      );
      continue;
    }
    const distance = Math.hypot(dx, dy);
    const scale = distance > 0
      ? Math.min(edge / options.range, edge / distance)
      : 0;
    context.beginPath();
    const x = options.x + dx * scale;
    const y = options.y + dy * scale;
    const highlight = options.markerHighlights?.[marker.id];
    if (highlight) {
      highlighted.push({ x, y, highlight });
      continue;
    }
    if (shape === "diamond") {
      context.moveTo(x, y - markerRadius);
      context.lineTo(x + markerRadius, y);
      context.lineTo(x, y + markerRadius);
      context.lineTo(x - markerRadius, y);
      context.closePath();
    } else {
      context.arc(x, y, markerRadius, 0, Math.PI * 2);
    }
    context.fill();
  }
  // Highlights draw above ordinary markers but inside the radar clip, center dot last.
  for (const { x, y, highlight } of highlighted) {
    const centerRadius = highlight.centerRadius ?? DEFAULT_HIGHLIGHT_CENTER_RADIUS;
    const pulseRadius = highlight.pulseRadius ?? DEFAULT_HIGHLIGHT_PULSE_RADIUS;
    context.save();
    context.strokeStyle = highlight.color;
    context.fillStyle = highlight.color;
    context.lineWidth = 2;
    if (highlight.phase === undefined) {
      const haloRadius = centerRadius + (pulseRadius - centerRadius) * 0.6;
      context.globalAlpha = 0.3;
      context.beginPath();
      context.arc(x, y, haloRadius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.8;
      context.beginPath();
      context.arc(x, y, haloRadius, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.globalAlpha = 1 - highlight.phase;
      context.beginPath();
      context.arc(x, y, centerRadius + (pulseRadius - centerRadius) * highlight.phase, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(x, y, centerRadius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#04101f";
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  if (options.anchorColor) {
    context.fillStyle = options.anchorColor;
    context.beginPath();
    context.arc(options.x, options.y, 4, 0, Math.PI * 2);
    context.fill();
  }
  if (options.facing && options.anchorColor) {
    const facingLength = Math.hypot(options.facing.x, options.facing.y);
    const facingX = facingLength === 0 ? 0 : options.facing.x / facingLength;
    const facingY = facingLength === 0 ? 0 : options.facing.y / facingLength;
    context.beginPath();
    context.arc(
      options.x + facingX * 4.5,
      options.y + facingY * 4.5,
      2,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  context.fillStyle = "#f4f1e8";
  context.font = "bold 10px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("N", options.x, options.y - options.radius + 10);
  context.restore();

  context.beginPath();
  context.arc(options.x, options.y, options.radius, 0, Math.PI * 2);
  context.strokeStyle = options.borderColor ?? "#dbe7f2";
  context.lineWidth = 2;
  context.stroke();
}
