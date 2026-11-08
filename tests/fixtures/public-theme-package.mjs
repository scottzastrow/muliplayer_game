import { readFileSync, writeFileSync } from "node:fs";
import {
  calculateThemeAssetHash,
  calculateThemePackageDigest,
  ThemePackageManifestSchema,
  validateThemePackageAssets
} from "@multiplayer-game/theme-sdk/package";
import { createThemeZip, png } from "./theme-archive.ts";

const required = png();
const optional = png(2, 1);
const manifest = {
  ...JSON.parse(readFileSync("definition.json", "utf8")),
  id: "public-package",
  name: "Public package fixture",
  project: "  Public package project  ",
  author: "Public fixture team",
  course: "Optional course",
  assets: {
    required: { logo: { path: "images/logo.png", sha256: calculateThemeAssetHash(required) } },
    optional: {
      alternate: { path: "images/alternate.png", sha256: calculateThemeAssetHash(optional) },
      absent: { path: "images/absent.png", sha256: calculateThemeAssetHash(png(3, 1)) }
    }
  }
};
manifest.assetsDigest = calculateThemePackageDigest(manifest);
const validated = ThemePackageManifestSchema.parse(manifest);
validateThemePackageAssets(validated, new Map([
  ["images/logo.png", { sha256: calculateThemeAssetHash(required) }],
  ["images/alternate.png", { sha256: calculateThemeAssetHash(optional) }]
]));
writeFileSync("theme.zip", createThemeZip([
  { path: "theme.json", bytes: Buffer.from(JSON.stringify(manifest)) },
  { path: "images/logo.png", bytes: required },
  { path: "images/alternate.png", bytes: optional }
], { deflate: true, descriptor: true }));
writeFileSync("expected.json", JSON.stringify(manifest));
