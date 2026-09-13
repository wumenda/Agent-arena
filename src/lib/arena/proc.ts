import { execFile, spawn } from "node:child_process";

// Windows 下杀整棵进程树（shell:true 会产生 cmd 中间层），POSIX 杀进程组
export function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: true });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
}

// 结束监听指定端口的进程（服务预览清理用）。返回成功处理的 PID 数；自身 PID 永不终止。
// Windows 走 Get-NetTCPConnection 找监听 PID 后 Stop-Process；POSIX 用 fuser -k 兜底
export function killPortListeners(port: number): Promise<number> {
  if (process.platform === "win32") {
    const script =
      `$own=${process.pid};` +
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |` +
      `Select-Object -ExpandProperty OwningProcess -Unique |` +
      `Where-Object { $_ -ne $own } |` +
      `ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; $_ }`;
    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000 }, (err, stdout) => {
        if (err) return resolve(0);
        resolve(stdout.split(/\s+/).filter(Boolean).length);
      });
    });
  }
  return new Promise((resolve) => {
    execFile("fuser", ["-k", `${port}/tcp`], { timeout: 15000 }, (err) => resolve(err ? 0 : 1));
  });
}
