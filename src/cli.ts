#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import { diff } from "./diff.js";
import { readJson } from "./document.js";

const usage = `Usage:
  json-guard validate <schema.json> <file.json> [--json]
  json-guard diff <before.json> <after.json> [--json]
  json-guard --help`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }

  const [command, first, second] = positionals;
  if (positionals.length !== 3 || (command !== "validate" && command !== "diff")) {
    throw new Error(usage);
  }

  if (command === "validate") {
    const schema = await readJson(first);
    if (typeof schema !== "boolean" && (schema === null || typeof schema !== "object" || Array.isArray(schema))) {
      throw new Error("expected a JSON Schema object or boolean");
    }
    // The synchronous compiler resolves local references only. JSON data is
    // neither coerced nor modified, and values are never emitted in a report.
    const ajv = new Ajv2020({ strict: true, ownProperties: true });
    const validate = ajv.compile(schema);
    if ("$async" in validate && validate.$async) throw new Error("asynchronous schemas are unsupported");
    const data = await readJson(second);
    const valid = validate(data);
    if (typeof valid !== "boolean") throw new Error("asynchronous schemas are unsupported");
    const errors = (validate.errors ?? []).map(({ instancePath, schemaPath, keyword }) => ({
      path: instancePath, schemaPath, keyword,
    }));
    print(
      { valid, errors },
      valid ? ["JSON matches the schema."] : errors.map(
        ({ path, schemaPath, keyword }) => `${JSON.stringify(path)} fails ${keyword} at ${JSON.stringify(schemaPath)}`,
      ),
    );
    return valid ? 0 : 1;
  }

  const before = await readJson(first);
  const after = await readJson(second);
  const changes = diff(before, after);
  print(
    { equal: changes.length === 0, changes },
    changes.length === 0
      ? ["No differences."]
      : changes.map(({ kind, path }) => `${kind} ${JSON.stringify(path)}`),
  );
  return changes.length === 0 ? 0 : 1;

  function print(report: object, lines: string[]): void {
    console.log(values.json ? JSON.stringify(report, null, 2) : lines.join("\n"));
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 2;
}
