# Json Guard

Validate a configuration file against a versioned JSON Schema and compare two JSON snapshots before shipping a change. Json Guard runs locally, accepts JSON files, and reports which fields failed or changed using JSON Pointer paths.

## Get started

Requires Node.js 22 or later.

```sh
npm ci
npm run build
node dist/cli.js validate examples/settings.schema.json examples/settings.json
node dist/cli.js diff before.json after.json --json
npm test
```

`validate` accepts JSON Schema Draft 2020-12 from a trusted local file. Internal references such as `#/$defs/settings` work. Remote references, async schemas, and custom formats are unsupported. Adjust the schema's `version` property to enforce a specific configuration version.

`diff` reports added, removed, and changed paths. Object key order does not affect the result. Array items are compared by index, so inserting an item near the beginning can produce several changes. An empty JSON Pointer identifies the whole document. These reports describe changes and cannot be applied as patches.

Pass `--json` to either command for a machine-readable report on standard output. Operational failures are printed to standard error. Reports include field names and paths, so check them before sharing output from a private project.

| Exit code | Meaning |
| --- | --- |
| 0 | Data matches the schema, or the compared documents are equal |
| 1 | Data violates the schema, or the compared documents differ |
| 2 | Invalid arguments, invalid schema, unreadable file, malformed JSON, or oversized diff report |

The CLI accepts UTF-8 files of up to 1 MiB and up to 100 levels of nesting. Diff report output is limited to 1 MiB. The CLI never rewrites inputs. JSON parsing uses JavaScript number precision and the last value of duplicate keys. Encode exact large integers as strings. Only use schemas you trust, especially schemas with regular expressions.
