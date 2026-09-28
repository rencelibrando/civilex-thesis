"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Scale,
  MessageSquare,
  History,
  BookOpen,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sidebarNavItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: Scale,
  },
  {
    title: "Legal Chat",
    href: "/chat",
    icon: MessageSquare,
  },
  {
    title: "Case History",
    href: "/history",
    icon: History,
  },
  {
    title: "Civil Code",
    href: "/civil-code",
    icon: BookOpen,
  },
  {
    title: "Document Analysis",
    href: "/research",
    icon: FileText,
  },
];

import { useChat } from "@/context/chat-context";
import { useAuth } from "@/context/auth-context";

export function SidebarNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  let isTyping = false;
  try {
    const chat = useChat();
    isTyping = chat.isTyping;
  } catch {
    // If used outside ChatProvider (e.g. mobile sheet before provider), gracefully fallback
  }

  const handleLogout = async () => {
    try {
      await signOut();
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="py-3 px-2 sm:px-2.5 xl:py-4 xl:px-3 flex flex-col flex-grow overflow-y-auto custom-scrollbar">
        <nav className="flex flex-col gap-1">
          {sidebarNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const isChatRunning = item.href === "/chat" && isTyping;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 xl:gap-3 px-3 py-2 xl:px-3.5 xl:py-2.5 2xl:py-2.5 rounded-xl transition-all duration-200 group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none text-[13px] sm:text-[13.5px] xl:text-sm 2xl:text-[15px] leading-snug",
                  isActive
                    ? "bg-accent/80 text-primary font-semibold shadow-2xs"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium"
                )}
              >
                <item.icon
                  className={cn(
                    "w-4 h-4 xl:w-4.5 xl:h-4.5 2xl:w-5 2xl:h-5 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className="flex-1 truncate">{item.title}</span>
                {isChatRunning && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 shrink-0">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                    </span>
                    Active
                  </span>
                )}
                {isActive && !isChatRunning && (
                  <div className="ml-auto w-1 h-3.5 xl:h-4 2xl:h-4.5 bg-primary rounded-full shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-2 sm:p-2.5 xl:p-3 border-t border-border flex flex-col gap-0.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 xl:gap-3 px-3 py-2 xl:px-3.5 xl:py-2.5 rounded-xl transition-all duration-200 group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none text-[13px] sm:text-[13.5px] xl:text-sm 2xl:text-[15px] leading-snug",
            pathname === "/settings"
              ? "bg-accent/80 text-primary font-semibold shadow-2xs"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium"
          )}
        >
          <Settings className={cn("w-4 h-4 xl:w-4.5 xl:h-4.5 2xl:w-5 2xl:h-5 shrink-0 transition-colors", pathname === "/settings" ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
          <span className="truncate">Settings</span>
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 xl:gap-3 px-3 py-2 xl:px-3.5 xl:py-2.5 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:outline-none cursor-pointer text-left text-[13px] sm:text-[13.5px] xl:text-sm 2xl:text-[15px] font-medium leading-snug group"
        >
          <LogOut className="w-4 h-4 xl:w-4.5 xl:h-4.5 2xl:w-5 2xl:h-5 text-muted-foreground group-hover:text-destructive shrink-0 transition-colors" />
          <span className="truncate">Sign Out</span>
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-56 xl:w-60 2xl:w-64 flex-shrink-0 border-r border-border bg-sidebar h-[calc(100dvh-3.5rem)] 2xl:h-[calc(100dvh-4rem)] flex flex-col justify-between hidden lg:flex transition-[width] duration-200">
      <SidebarNav />
    </aside>
  );
}
