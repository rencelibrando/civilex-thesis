import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { ChatProvider } from "@/context/chat-context";
import { DocChatProvider } from "@/context/doc-chat-context";
import { AuthGuard } from "@/components/auth/auth-guard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ChatProvider>
        <DocChatProvider>
          <div className="flex flex-col h-full overflow-hidden bg-background">
            <Header />
            <div className="flex flex-1 overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-hidden p-2.5 sm:p-3.5 lg:p-4 2xl:p-6 flex flex-col min-w-0">
                {children}
              </main>
            </div>
          </div>
        </DocChatProvider>
      </ChatProvider>
    </AuthGuard>
  );
}
