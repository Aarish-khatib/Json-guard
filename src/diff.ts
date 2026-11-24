import type { JsonValue } from "./document.js";

export type Change = { kind: "added" | "removed" | "changed"; path: string };

export function diff(before: JsonValue, after: JsonValue): Change[] {
  const changes: Change[] = [];
  let reportSize = 0;
  compare(before, after, "");
  return changes;

  function record(kind: Change["kind"], path: string): void {
    // Charge for JSON escaping and per-change overhead before retaining the path.
    reportSize += Buffer.byteLength(JSON.stringify(path)) + 64;
    if (reportSize > 1_048_576) throw new Error("diff report exceeds 1 MiB");
    changes.push({ kind, path });
  }

  function compare(previous: JsonValue, current: JsonValue, path: string): void {
    if (previous === current) return;

    if (Array.isArray(previous) && Array.isArray(current)) {
      const sharedLength = Math.min(previous.length, current.length);
      for (let index = 0; index < sharedLength; index++) {
        compare(previous[index], current[index], `${path}/${index}`);
      }
      for (let index = sharedLength; index < previous.length; index++) {
        record("removed", `${path}/${index}`);
      }
      for (let index = sharedLength; index < current.length; index++) {
        record("added", `${path}/${index}`);
      }
      return;
    }

    if (
      previous !== null && current !== null &&
      typeof previous === "object" && typeof current === "object" &&
      !Array.isArray(previous) && !Array.isArray(current)
    ) {
      const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
      for (const key of keys) {
        const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (!Object.hasOwn(previous, key)) {
          record("added", childPath);
        } else if (!Object.hasOwn(current, key)) {
          record("removed", childPath);
        } else {
          compare(previous[key], current[key], childPath);
        }
      }
      return;
    }

    record("changed", path);
  }
}
