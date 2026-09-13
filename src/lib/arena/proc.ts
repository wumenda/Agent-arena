import { spawn } from "node:child_process";

// Windows 下杀整棵进程树（shell:true 会产生 cmd 中间层），POSIX 杀进程组
export function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: true });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
}
