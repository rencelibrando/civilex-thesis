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

export function SidebarNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="py-6 px-4 flex flex-col gap-2 flex-grow overflow-y-auto">
        <div className="mb-4 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Menu
        </div>
        <nav className="flex flex-col gap-1">
          {sidebarNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none",
                  isActive
                    ? "bg-accent text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "w-5 h-5",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span>{item.title}</span>
                {isActive && (
                  <div className="ml-auto w-1 h-5 bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-border">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none",
            pathname === "/settings"
              ? "bg-accent text-primary font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <Settings className={cn("w-5 h-5", pathname === "/settings" ? "text-primary" : "text-muted-foreground")} />
          <span>Settings</span>
        </Link>
        <Link
          href="/login"
          className="flex items-center gap-3 px-4 py-3 mt-1 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <LogOut className="w-5 h-5 text-muted-foreground" />
          <span>Sign Out</span>
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar h-[calc(100vh-4rem)] flex flex-col justify-between hidden md:flex">
      <SidebarNav />
    </aside>
  );
}
