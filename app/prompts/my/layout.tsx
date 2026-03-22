import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My prompts — AI Tools",
  description: "Your saved AI prompt templates.",
};

export default function MyPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
