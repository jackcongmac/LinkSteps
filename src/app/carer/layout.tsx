import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "平安扣 · 家人动态",
  description: "实时关注家人的平安状态",
};

export default function CarerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
