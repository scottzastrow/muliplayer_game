import { z } from "zod";

const portSchema = z
  .string()
  .regex(/^[0-9]+$/, "must be an integer from 1 to 65535")
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

const originSchema = z.string().url().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        (url.pathname === "/" || url.pathname === "")
      );
    } catch {
      return false;
    }
  },
  { message: "must be an HTTP(S) origin without credentials, path, query, or fragment" }
);

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    HOST: z.string().min(1).max(255).regex(/^[^\s/\\]+$/),
    PORT: portSchema,
    PUBLIC_ORIGIN: originSchema,
    DATABASE_PATH: z.string().trim().min(1).max(4_096).refine(
      (value) => !/[\r\n\0]/.test(value),
      { message: "must not contain line breaks or null characters" }
    )
  })
  .strict();

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly databasePath: string;
}

export class ConfigurationError extends Error {
  constructor(readonly invalidFields: readonly string[]) {
    super(`Invalid application configuration: ${invalidFields.join(", ")}.`);
    this.name = "ConfigurationError";
  }
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse({
    NODE_ENV: environment.NODE_ENV ?? "development",
    HOST: environment.HOST ?? "127.0.0.1",
    PORT: environment.PORT ?? "8082",
    PUBLIC_ORIGIN: environment.PUBLIC_ORIGIN ?? "http://localhost:5173",
    DATABASE_PATH: environment.DATABASE_PATH ?? "./var/game.sqlite"
  });

  if (!parsed.success) {
    const invalidFields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "configuration")))
    ];
    throw new ConfigurationError(invalidFields);
  }

  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    publicOrigin: new URL(parsed.data.PUBLIC_ORIGIN).origin,
    databasePath: parsed.data.DATABASE_PATH
  });
}
