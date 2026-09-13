import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import MotionProvider from "@/components/MotionProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent 竞技场",
  description: "一句话发起多 harness 编程对局，实时对比轨迹与产出",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {/* 悬浮液态玻璃胶囊导航 */}
        <header className="nav-drop fixed top-4 left-1/2 z-50 -translate-x-1/2">
          <nav className="glass-strong flex items-center gap-1 rounded-full pl-4 pr-1.5 py-1.5 text-sm whitespace-nowrap">
            <Link
              href="/"
              className="mr-2 flex items-center gap-2 font-semibold tracking-tight text-white/90"
            >
              <span className="inline-block size-2 rounded-full bg-gradient-to-br from-sky-400 to-violet-500 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
              Agent 竞技场
            </Link>
            <Link
              href="/"
              className="rounded-full px-3 py-1 text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              新建对局
            </Link>
            <Link
              href="/history"
              className="rounded-full px-3 py-1 text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              历史对局
            </Link>
            <Link
              href="/stats"
              className="rounded-full px-3 py-1 text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              统计
            </Link>
          </nav>
        </header>
        <div className="flex-1 flex flex-col pt-20">
          <MotionProvider>{children}</MotionProvider>
        </div>
      </body>
    </html>
  );
}
