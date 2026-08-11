import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "暖窝双蛇 · 点对点联机贪吃蛇",
  description: "无需账号与游戏服务器，邀请朋友来一场温柔的双人贪吃蛇。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
