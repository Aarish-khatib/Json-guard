import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function files(t, fixtures) {
  const root = await mkdtemp(join(tmpdir(), "json-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(fixtures)) {
    await writeFile(join(root, name), value);
  }
  return (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    return result;
  };
}

test("validates a local JSON Schema with an internal reference", async (t) => {
  const run = await files(t, {
    "schema.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: { formatVersion: { const: 1 } },
      type: "object",
      required: ["version"],
      properties: { version: { $ref: "#/$defs/formatVersion" } },
    }),
    "good.json": '\uFEFF{"version":1}',
    "bad.json": '{"version":"value-stays-private"}',
  });
  const good = run("validate", "schema.json", "good.json", "--json");
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), { valid: true, errors: [] });

  const bad = run("validate", "schema.json", "bad.json", "--json");
  assert.equal(bad.status, 1, bad.stderr);
  assert.deepEqual(JSON.parse(bad.stdout), {
    valid: false,
    errors: [{ path: "/version", schemaPath: "#/$defs/formatVersion/const", keyword: "const" }],
  });
  assert.doesNotMatch(bad.stdout + bad.stderr, /value-stays-private/);
});

test("reports ordered JSON Pointer locations and compares arrays by index", async (t) => {
  const run = await files(t, {
    "old.json": '{"z":1,"v":["old",1,2],"obj":{"toString":true,"x/y":2}}',
    "new.json": '{"v":["new",1],"obj":{"x/y":3,"~0":true},"a":{"inner":5}}',
  });
  const result = run("diff", "old.json", "new.json", "--json");
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    equal: false,
    changes: [
      { kind: "added", path: "/a" },
      { kind: "removed", path: "/obj/toString" },
      { kind: "changed", path: "/obj/x~1y" },
      { kind: "added", path: "/obj/~00" },
      { kind: "changed", path: "/v/0" },
      { kind: "removed", path: "/v/2" },
      { kind: "removed", path: "/z" },
    ],
  });
});

test("ignores object key order and denotes a root change with an empty pointer", async (t) => {
  const run = await files(t, {
    "left.json": '{"one":1,"two":2}',
    "right.json": '{"two":2,"one":1}',
    "null.json": "null",
  });
  const same = run("diff", "left.json", "right.json", "--json");
  assert.equal(same.status, 0, same.stderr);
  assert.deepEqual(JSON.parse(same.stdout), { equal: true, changes: [] });

  const root = run("diff", "left.json", "null.json", "--json");
  assert.equal(root.status, 1, root.stderr);
  assert.deepEqual(JSON.parse(root.stdout).changes, [{ kind: "changed", path: "" }]);
});

test("rejects broken inputs, excessive size and depth, and non-finite numbers", async (t) => {
  const run = await files(t, {
    "valid.json": "true",
    "broken.json": "{broken-private-text",
    "huge.json": " ".repeat(1_048_577),
    "deep.json": "[".repeat(101) + "0" + "]".repeat(101),
    "utf8.json": Buffer.from([0xc0, 0xaf]),
    "infinite.json": "1e999",
  });
  const cases = {
    "broken.json": /invalid JSON syntax/,
    "huge.json": /exceeds 1 MiB/,
    "deep.json": /100 levels/,
    "utf8.json": /UTF-8/i,
    "infinite.json": /finite JavaScript/,
    "absent.json": /ENOENT/,
    ".": /regular file/,
  };
  for (const [name, pattern] of Object.entries(cases)) {
    const result = run("diff", "valid.json", name, "--json");
    assert.equal(result.status, 2, name);
    assert.equal(result.stdout, "", name);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stderr, /broken-private-text/);
  }
});

test("reports invalid or external schemas and handles command-line usage", async (t) => {
  const run = await files(t, {
    "valid.json": "true",
    "invalid-schema.json": '{"type":"unknown"}',
    "external-schema.json": '{"$ref":"https://example.invalid/schema.json"}',
    "async-schema.json": '{"$async":true,"type":"boolean"}',
  });
  for (const schema of ["invalid-schema.json", "external-schema.json", "async-schema.json"]) {
    const result = run("validate", schema, "valid.json");
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
  }
  assert.match(run("--help").stdout, /Usage/);
  assert.equal(run("diff", "valid.json").status, 2);
  assert.equal(run("diff", "valid.json", "valid.json", "--unknown").status, 2);
});

test("bounds large reports generated by repeating a long parent pointer", async (t) => {
  const key = "x".repeat(40_000);
  const run = await files(t, {
    "before.json": JSON.stringify({ [key]: Array(30).fill(0) }),
    "after.json": JSON.stringify({ [key]: Array(30).fill(1) }),
  });
  const result = run("diff", "before.json", "after.json", "--json");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /diff report exceeds 1 MiB/);
});
