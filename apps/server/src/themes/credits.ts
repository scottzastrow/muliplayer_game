import { z } from "zod";
import { ThemeDefinitionSchema, type ThemeDefinition } from "@multiplayer-game/theme-sdk";

function requiredCredit(label: string, field: string) {
  const message = `${label} (${field}) is required and must be a nonblank string.`;
  return z.string({ error: message }).refine((value) => value.trim().length > 0, { message });
}

export const ThemeCreditsSchema = z.object({
  project: requiredCredit("Project", "project"),
  author: requiredCredit("Author", "author"),
  course: z.string().optional()
}).strict();

export const ThemeImportDefinitionSchema = ThemeDefinitionSchema.safeExtend(ThemeCreditsSchema.shape);
export type ThemeImportDefinition = z.infer<typeof ThemeImportDefinitionSchema>;

export function runtimeThemeDefinition(manifest: ThemeImportDefinition): ThemeDefinition {
  const { project: _project, author: _author, course: _course, ...definition } = manifest;
  return definition;
}
