import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--no-launch")) {
  console.error("Usage: npm run setup -- [--no-launch]");
  process.exit(1);
}

let command;
let setupArgs;
if (process.platform === "win32") {
  command = "powershell.exe";
  setupArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "./setup-and-run.ps1"];
  if (args.includes("--no-launch")) setupArgs.push("-NoLaunch");
} else if (process.platform === "linux") {
  command = "bash";
  setupArgs = ["./setup-and-run.sh", ...args];
} else {
  console.error(`Unsupported system: ${process.platform}. Setup supports Windows and Linux.`);
  process.exit(1);
}

console.log(`Preparing KNeuron and native sidecars for ${process.platform}...`);
const child = spawn(command, setupArgs, { cwd: root, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Cannot start setup: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
