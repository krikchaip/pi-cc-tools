#!/usr/bin/env node

import { spawn } from "node:child_process";

process.stdin.setEncoding("utf8");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

let input = "";
let ready = false;

function showReady() {
  ready = true;
  process.stdout.write("\u001b[?1000h\u001b[?1006h\u001b[2J\u001b[HSMOKE READY\r\n");
  process.stdout.write(`HOME ${process.env.HOME}\r\nAGENT ${process.env.PI_CODING_AGENT_DIR}\r\n`);
  if (process.env.SESSION_REF) {
    const sessionArgument = process.argv[process.argv.indexOf("--session") + 1];
    process.stdout.write(`SESSION_REF_MATCH ${process.env.SESSION_REF === sessionArgument}\r\n`);
  }
}

if (process.env.SMOKE_SPAWN_CHILD === "1" || process.env.SMOKE_SPAWN_DETACHED_CHILD === "1") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
    detached: process.env.SMOKE_SPAWN_DETACHED_CHILD === "1",
    stdio: "ignore",
  });
  process.stdout.write(`CHILD_PID ${child.pid}\r\n`);
}

if (process.env.SMOKE_SPAWN_DAEMON === "1") {
  const helper = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
      detached: true,
      stdio: "ignore",
    });
    writeFileSync(process.env.SMOKE_DAEMON_PID_FILE, String(daemon.pid));
    daemon.unref();
  `], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  helper.unref();
}

process.stdin.on("data", (chunk) => {
  input += chunk;

  if (!ready && input.includes("\u001b[?1;2c") && input.includes("\u001b[?0u")) showReady();

  if (input.includes("hello\r")) {
    input = input.replace("hello\r", "");
    process.stdout.write("\u001b[31mACK hello\u001b[0m\r\n");
  }

  const click = /\u001b\[<0;(\d+);(\d+)[Mm]/.exec(input);
  if (click) {
    input = input.slice((click.index ?? 0) + click[0].length);
    process.stdout.write(`CLICK ${click[1]} ${click[2]}\r\n`);
  }

  if (input.includes("\u0003")) process.exit(0);
});

if (process.env.SMOKE_READY_IMMEDIATELY === "1") {
  showReady();
} else {
  process.stdout.write("\u001b[");
  setTimeout(() => process.stdout.write("c\u001b[?"), 5);
  setTimeout(() => process.stdout.write("u"), 10);
}
