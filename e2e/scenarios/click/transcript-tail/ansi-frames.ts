import { createRequire } from "node:module";

import type * as Xterm from "@xterm/headless";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof Xterm;

export async function replaySynchronizedFrames(
  initialLines: readonly string[],
  raw: string,
  columns: number,
  rows: number,
): Promise<readonly (readonly string[])[]> {
  const terminal = new Terminal({ cols: columns, rows, allowProposedApi: true });
  try {
    await write(terminal, `\x1b[2J\x1b[H${initialLines.join("\r\n")}`);
    const frames: string[][] = [];
    const boundary = "\x1b[?2026l";
    let offset = 0;
    for (;;) {
      const end = raw.indexOf(boundary, offset);
      if (end === -1) break;
      await write(terminal, raw.slice(offset, end + boundary.length));
      frames.push(snapshot(terminal, rows));
      offset = end + boundary.length;
    }
    if (offset < raw.length) {
      await write(terminal, raw.slice(offset));
      frames.push(snapshot(terminal, rows));
    }
    return frames;
  } finally {
    terminal.dispose();
  }
}

function write(terminal: Xterm.Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function snapshot(terminal: Xterm.Terminal, rows: number): string[] {
  const buffer = terminal.buffer.active;
  return Array.from({ length: rows }, (_, index) =>
    buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? "",
  );
}
