import type { Metadata } from "next";
import { ChatScreen } from "@/components/cxo/ChatScreen";

export const metadata: Metadata = { title: "Ask AI" };

export default function Page() {
  return <ChatScreen />;
}
