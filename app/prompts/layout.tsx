import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Community prompts — AI Tools",
  description:
    "Browse curated prompt templates by category. Save favorites to My prompts.",
};

export default function PromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
