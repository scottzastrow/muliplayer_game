# Theme Credits data model

## Handoff manifest

Existing manifest fields plus:

| Key | Value | Validation |
| --- | --- | --- |
| `project` | Project's public name | Required string containing non-whitespace |
| `author` | Public person or team | Required string containing non-whitespace |
| `course` | Optional course | Optional string |

No automatic identity extraction constitutes confirmation. No invented placeholder
credits. Values are retained exactly so validation does not silently alter hashes.
Credit fields are included in canonical asset-package digest computation.

## Installed runtime definition

Unchanged SDK schema and database schema. Existing themes continue to resolve their
exact old revision/digest. New package credits persist in the promoted `theme.json`;
runtime compatibility validation receives only its existing definition fields.

## Future setup suggestions and headers (blocked)

Suggestions associate each candidate with its metadata/comment source; conflicts
must remain separate choices until developer confirmation. Confirmation writes
credits to the manifest. Each generated source header contains Project, Author,
file-specific Description and optional Course; existing attribution is preserved.
No generator or associated state is introduced in this engine-only slice.
