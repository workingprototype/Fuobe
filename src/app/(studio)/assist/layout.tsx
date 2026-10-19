import { AssistShell } from "@/components/assist/shell";

/** Assist's own sidebar (chats, projects, skills, memory) beside every Assist page. */
export default function AssistLayout({ children }: LayoutProps<"/assist">) {
  return <AssistShell>{children}</AssistShell>;
}
