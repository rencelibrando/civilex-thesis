"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Scale, Menu, Settings, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/layout/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { BACKEND_URL, apiUrl } from "@/lib/config";
import { getCachedProfile, saveCachedProfile } from "@/lib/auth-storage";

export function Header() {
  const router = useRouter();
  const { session, token, signOut } = useAuth();
  const [userName, setUserName] = useState<string>("User");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  const [userOrg, setUserOrg] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const fetchProfile = async (silent = false) => {
    try {
      if (!session) return;
      const userId = session.user.id;

      // Step 1: Instant 0ms Hydration from client device cache
      const cached = getCachedProfile(userId);
      const metaAvatar =
        session.user.user_metadata?.avatar_url ||
        session.user.user_metadata?.picture ||
        null;

      if (cached) {
        if (cached.full_name) setUserName(cached.full_name);
        if (cached.role) setUserRole(cached.role);
        if (cached.organization) setUserOrg(cached.organization);
        if (cached.avatar_url !== undefined) {
          setAvatarUrl(cached.avatar_url || metaAvatar);
        }
      } else {
        setUserEmail(session.user.email || "");
        if (session.user.user_metadata?.full_name) {
          setUserName(session.user.user_metadata.full_name);
        }
        if (session.user.user_metadata?.role) {
          setUserRole(session.user.user_metadata.role);
        }
        if (session.user.user_metadata?.organization) {
          setUserOrg(session.user.user_metadata.organization);
        }
        if (metaAvatar) {
          setAvatarUrl(metaAvatar);
        }
      }

      const authToken = token || session.access_token;
      if (!authToken) return;

      // Step 2: Background SWR revalidation with fast direct route (no 4s hang)
      const primaryUrl = apiUrl("/api/profiles/me");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      let res = await fetch(primaryUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);

      // Fallback to relative /api/profiles/me only if primaryUrl was external and failed
      if (!res?.ok && primaryUrl !== "/api/profiles/me") {
        res = await fetch("/api/profiles/me", {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }).catch(() => null);
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data.full_name) setUserName(data.full_name);
        if (data.role) setUserRole(data.role);
        if (data.organization) setUserOrg(data.organization);
        const resolvedAvatar = data.avatar_url || metaAvatar;
        setAvatarUrl(resolvedAvatar);

        // Update local persistent device cache
        saveCachedProfile(userId, {
          id: userId,
          full_name: data.full_name || session.user.user_metadata?.full_name || "User",
          role: data.role || session.user.user_metadata?.role || "",
          organization: data.organization || session.user.user_metadata?.organization || "",
          avatar_url: resolvedAvatar,
          email: session.user.email,
        });
      }
    } catch (err) {
      console.error("Failed to fetch header user profile", err);
    }
  };

  useEffect(() => {
    fetchProfile();

    const handleProfileUpdated = () => {
      if (session?.user?.id) {
        const cached = getCachedProfile(session.user.id);
        if (cached) {
          if (cached.full_name) setUserName(cached.full_name);
          if (cached.role) setUserRole(cached.role);
          if (cached.organization) setUserOrg(cached.organization);
          if (cached.avatar_url !== undefined) setAvatarUrl(cached.avatar_url);
        }
      }
      fetchProfile(true);
    };

    window.addEventListener("profile-updated", handleProfileUpdated);

    return () => {
      window.removeEventListener("profile-updated", handleProfileUpdated);
    };
  }, [session, token]);

  const handleLogout = async () => {
    try {
      await signOut();
    } finally {
      window.location.href = "/login";
    }
  };

  const initials = userName
    ? userName
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <header className="h-14 2xl:h-16 border-b border-border bg-background text-foreground flex items-center justify-between px-3.5 sm:px-4 2xl:px-6 z-10 sticky top-0 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <Sheet>
          <SheetTrigger render={
            <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9 text-muted-foreground hover:text-foreground" />
          }>
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] sm:w-72 max-w-xs p-0">
            <div className="flex items-center gap-2.5 p-5 border-b border-border">
              <Scale className="w-5 h-5 text-[#100771] dark:text-blue-500 shrink-0" />
              <span className="font-bold text-lg tracking-wide">CIVIL-LEX</span>
            </div>
            <SidebarNav className="h-[calc(100dvh-4.5rem)]" />
          </SheetContent>
        </Sheet>
        <Link href="/dashboard" className="font-bold text-base sm:text-lg tracking-wide flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none rounded-md">
          <Scale className="w-5 h-5 text-[#100771] dark:text-blue-500 shrink-0" />
          <span>CIVIL-LEX</span>
          <span className="font-normal text-muted-foreground text-xs sm:text-sm hidden sm:inline-block">Legal Intelligence</span>
        </Link>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        
        <div className="w-px h-6 bg-border mx-1"></div>

        <DropdownMenu>
          <DropdownMenuTrigger className="relative h-9 w-9 rounded-full ml-1 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-transform active:scale-95 cursor-pointer">
            <Avatar className="h-9 w-9 border border-border shadow-xs">
              <AvatarImage src={avatarUrl || undefined} alt={userName} className="object-cover" />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60 sm:w-64 max-w-[90vw] p-2" align="end">
            <div className="px-2 py-2">
              <p className="text-sm font-semibold leading-none text-foreground truncate">{userName}</p>
              {userEmail && (
                <p className="text-xs text-muted-foreground truncate mt-1">{userEmail}</p>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {userRole && (
                  <span className="inline-block text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md truncate max-w-full">
                    {userRole}
                  </span>
                )}
                {userOrg && (
                  <span className="inline-block text-[11px] font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-md truncate max-w-full">
                    {userOrg}
                  </span>
                )}
              </div>
            </div>
            <DropdownMenuSeparator className="my-1" />
            <Link href="/settings" className="w-full">
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="w-4 h-4 mr-2" />
                Profile & Settings
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
