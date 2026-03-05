/**
 * pi-dash — system dashboard. /dash
 * Shows CPU, memory, uptime, disk, Node info, git status, processes.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { statSync, readdirSync } from "node:fs";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const RST = "\x1b[0m";

function bar(frac: number, w: number, color: string): string {
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * w);
  return `\x1b[${color}m${"█".repeat(filled)}\x1b[2m${"░".repeat(w - filled)}${RST}`;
}

function fmtBytes(b: number): string {
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(0) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function cmd(c: string): string { try { return execSync(c, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).toString().trim(); } catch { return ""; } }

interface DashData {
  hostname: string; platform: string; arch: string; release: string;
  cpuModel: string; cpuCores: number; cpuUsage: number;
  memTotal: number; memUsed: number; memFrac: number;
  uptime: string; loadAvg: number[];
  nodeVer: string; npmVer: string; gitBranch: string; gitStatus: string;
  cwd: string; cwdFiles: number;
  topProcs: string[];
  diskInfo: string;
  time: string; date: string;
}

function gather(): DashData {
  const cpus = os.cpus();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const now = new Date();

  // CPU usage estimate (idle ratio)
  let cpuIdle = 0, cpuTotal = 0;
  for (const c of cpus) { for (const t of Object.values(c.times)) cpuTotal += t; cpuIdle += c.times.idle; }
  const cpuUsage = 1 - cpuIdle / cpuTotal;

  let gitBranch = "", gitStatus = "";
  try { gitBranch = cmd("git branch --show-current"); } catch {}
  try {
    const st = cmd("git status --porcelain");
    if (st) {
      const lines2 = st.split("\n").filter(Boolean);
      const m = lines2.filter(l => l.startsWith("M")).length;
      const a = lines2.filter(l => l.startsWith("A") || l.startsWith("?")).length;
      const d = lines2.filter(l => l.startsWith("D")).length;
      gitStatus = `${lines2.length} changes`;
      if (m) gitStatus += ` (${m}M`;
      if (a) gitStatus += `${m ? " " : "("}${a}A`;
      if (d) gitStatus += `${m || a ? " " : "("}${d}D`;
      if (m || a || d) gitStatus += ")";
    } else {
      gitStatus = "clean";
    }
  } catch {}

  let cwdFiles = 0;
  try { cwdFiles = readdirSync(process.cwd()).length; } catch {}

  let topProcs: string[] = [];
  try {
    const isWin = os.platform() === "win32";
    if (isWin) {
      const out = cmd('powershell -NoProfile -Command "Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 5 | Format-Table Name,@{L=\\"Mem(MB)\\";E={[math]::Round($_.WS/1MB)}},CPU -AutoSize | Out-String"');
      topProcs = out.split("\n").filter(l => l.trim()).slice(0, 7);
    } else {
      const out = cmd("ps aux --sort=-%mem | head -6");
      topProcs = out.split("\n").slice(0, 6);
    }
  } catch {}

  let diskInfo = "";
  try {
    if (os.platform() === "win32") {
      diskInfo = cmd('powershell -NoProfile -Command "(Get-PSDrive C).Used, (Get-PSDrive C).Free"');
      const parts = diskInfo.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const used = parseInt(parts[0]), free = parseInt(parts[1]);
        diskInfo = `${fmtBytes(used)} / ${fmtBytes(used + free)}`;
      }
    } else {
      diskInfo = cmd("df -h / | tail -1 | awk '{print $3 \"/\" $2}'");
    }
  } catch {}

  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release().split(".").slice(0, 2).join(".")}`,
    arch: os.arch(),
    release: os.release(),
    cpuModel: cpus[0]?.model?.replace(/\s+/g, " ").slice(0, 40) || "?",
    cpuCores: cpus.length,
    cpuUsage,
    memTotal, memUsed, memFrac: memUsed / memTotal,
    uptime: fmtUptime(os.uptime()),
    loadAvg: os.loadavg(),
    nodeVer: process.version,
    npmVer: cmd("npm --version"),
    gitBranch, gitStatus,
    cwd: process.cwd(),
    cwdFiles,
    topProcs,
    diskInfo,
    time: now.toLocaleTimeString(),
    date: now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  };
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

class DashComponent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private data: DashData;
  private version = 0;

  constructor(private tui: any, private done: (v: undefined) => void) {
    this.data = gather();
    this.timer = setInterval(() => { this.data = gather(); this.version++; this.tui.requestRender(); }, 3000);
  }

  handleInput(data: string) {
    if (data === "q" || data === "Q" || data === "\x03" || data === "\x1b") {
      this.dispose(); this.done(undefined); return;
    }
    if (data === "r" || data === "R") { this.data = gather(); this.version++; this.tui.requestRender(); }
  }

  invalidate() {}

  render(width: number): string[] {
    const d = this.data;
    const W = Math.min(70, width - 2);
    const barW = Math.max(10, W - 30);
    const lines: string[] = [];

    const row = (label: string, value: string, extra = "") => {
      const vis = visibleWidth(label) + visibleWidth(value) + visibleWidth(extra);
      return dim(" │ ") + label + " ".repeat(Math.max(1, W - vis - 1)) + value + extra + dim(" │");
    };

    lines.push(dim(` ╭${"─".repeat(W + 2)}╮`));
    lines.push(dim(" │ ") + bold(cyan("  SYSTEM DASHBOARD")) + " ".repeat(Math.max(0, W - 20)) + dim(`${d.time} │`));
    lines.push(dim(` ├${"─".repeat(W + 2)}┤`));

    // System
    lines.push(row(bold("Host"), `${d.hostname} · ${d.platform} · ${d.arch}`));
    lines.push(row(bold("Uptime"), d.uptime));
    lines.push(row(bold("CPU"), `${d.cpuModel}`));
    lines.push(row(`  ${d.cpuCores} cores`, `${(d.cpuUsage * 100).toFixed(0)}%`, ` ${bar(d.cpuUsage, barW, d.cpuUsage > 0.8 ? "31" : d.cpuUsage > 0.5 ? "33" : "32")}`));

    lines.push(dim(` ├${"─".repeat(W + 2)}┤`));

    // Memory
    const memPct = (d.memFrac * 100).toFixed(0);
    lines.push(row(bold("Memory"), `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)} (${memPct}%)`, ` ${bar(d.memFrac, barW, d.memFrac > 0.8 ? "31" : d.memFrac > 0.5 ? "33" : "32")}`));

    // Disk
    if (d.diskInfo) lines.push(row(bold("Disk"), d.diskInfo));

    lines.push(dim(` ├${"─".repeat(W + 2)}┤`));

    // Dev
    lines.push(row(bold("Node"), d.nodeVer + (d.npmVer ? ` · npm ${d.npmVer}` : "")));
    lines.push(row(bold("CWD"), d.cwd.length > W - 10 ? "..." + d.cwd.slice(-(W - 13)) : d.cwd));
    if (d.gitBranch) lines.push(row(bold("Git"), `${magenta(d.gitBranch)} · ${d.gitStatus === "clean" ? green(d.gitStatus) : yellow(d.gitStatus)}`));

    // Top processes
    if (d.topProcs.length > 0) {
      lines.push(dim(` ├${"─".repeat(W + 2)}┤`));
      lines.push(dim(" │ ") + bold("Top Processes") + " ".repeat(Math.max(0, W - 13)) + dim(" │"));
      for (const p of d.topProcs.slice(0, 5)) {
        const trimmed = p.slice(0, W);
        lines.push(dim(" │ ") + `\x1b[2m${trimmed}${RST}` + " ".repeat(Math.max(0, W - trimmed.length)) + dim(" │"));
      }
    }

    lines.push(dim(` ├${"─".repeat(W + 2)}┤`));
    lines.push(dim(" │ ") + dim("R=refresh  Q=quit") + " ".repeat(Math.max(0, W - 17)) + dim(" │"));
    lines.push(dim(` ╰${"─".repeat(W + 2)}╯`));

    return lines.map(l => l + " ".repeat(Math.max(0, width - visibleWidth(l))));
  }

  dispose() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("dash", {
    description: "System dashboard — CPU, memory, disk, git, processes. R=refresh, Q=quit.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) { ctx.ui.notify("Dashboard requires interactive mode", "error"); return; }
      await ctx.ui.custom((tui: any, _t: any, _k: any, done: (v: undefined) => void) => new DashComponent(tui, done));
    },
  });
}
