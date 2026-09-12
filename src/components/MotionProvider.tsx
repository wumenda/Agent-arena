"use client";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * 全局动画配置：
 * - 默认 iOS 手感弹簧（微交互 200-300ms 区间）
 * - reducedMotion="user"：尊重系统减少动态效果设置
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 400, damping: 34 }}>
      {children}
    </MotionConfig>
  );
}
