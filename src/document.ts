import { constants } from "node:fs";
import { open } from "node:fs/promises";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

const maxBytes = 1_048_576;
const maxDepth = 100;

export async function readJson(path: string): Promise<JsonValue> {
  try {
    // O_NONBLOCK avoids waiting on named pipes on systems that support them.
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    let source: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("expected a regular file");
      if (stat.size > maxBytes) throw new Error("file exceeds 1 MiB");
      const buffer = Buffer.allocUnsafe(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw new Error("file exceeds 1 MiB");
      source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    } finally {
      await file.close();
    }

    let value: JsonValue;
    try {
      value = JSON.parse(source) as JsonValue;
    } catch {
      throw new Error("invalid JSON syntax");
    }
    checkDocument(value, 0);
    return value;
  } catch (error) {
    throw new Error(`${JSON.stringify(path)}: ${(error as Error).message}`);
  }
}

function checkDocument(value: JsonValue, depth: number): void {
  if (depth > maxDepth) throw new Error("document exceeds 100 levels of nesting");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("number is outside the finite JavaScript range");
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) checkDocument(child, depth + 1);
  }
}
