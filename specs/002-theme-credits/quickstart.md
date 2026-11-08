# Theme Credits focused validation

From the engine root with its existing dependencies:

```powershell
npm run check
npm test -- tests\theme-packages.test.ts tests\operator-tools.test.ts tests\integration\theme-install.test.ts tests\integration\theme-admin.test.ts
```

`check` rebuilds protocol/SDK/reference themes before tests resolve workspace
exports. Expected: exact Project/Author errors for invalid credits, successful
credited imports with preserved manifest bytes, atomic failure, and continued
legacy installed-theme operation.

For a new handoff manifest, add confirmed public `project` and `author`; optional
`course` is a string. Recalculate the package digest after editing any manifest
field. Use the existing import commands in `docs/theme-development.md`; no new
export/setup command exists in this engine checkout.

Blocked validation: companion ZIP export, suggestion/conflict confirmation,
manifest write-back and generated Java, JavaScript/TypeScript, HTML/Python headers
plus comment-free JSON. Resume only with the actual local tooling/checkout.
No browser, capacity or deployment claim is part of this feature.
