import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "平安扣",
  description: "轻触，告诉家人您很好",
};

export default function SeniorHomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
