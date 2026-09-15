"use client";

import Link from "next/link";
import { Scale, Globe, Bell, Menu } from "lucide-react";
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

export function Header() {
  return (
    <header className="h-16 border-b border-border bg-background text-foreground flex items-center justify-between px-6 z-10 sticky top-0">
      <div className="flex items-center gap-3">
        <Sheet>
          <SheetTrigger render={
            <Button variant="ghost" size="icon" className="md:hidden text-muted-foreground hover:text-foreground" />
          }>
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="flex items-center gap-2 p-6 border-b border-border">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                <Scale className="w-5 h-5 text-primary" />
              </div>
              <span className="font-bold text-lg tracking-wide">CIVIL-LEX</span>
            </div>
            <SidebarNav className="h-[calc(100vh-5rem)]" />
          </SheetContent>
        </Sheet>
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center hidden md:flex">
          <Scale className="w-5 h-5 text-primary" />
        </div>
        <Link href="/dashboard" className="font-bold text-lg tracking-wide flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none rounded-md">
          CIVIL-LEX <span className="font-normal text-muted-foreground text-sm hidden sm:inline-block">Legal Intelligence</span>
        </Link>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full">
          <Globe className="w-5 h-5" />
        </Button>
        <div className="relative">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full">
            <Bell className="w-5 h-5" />
          </Button>
          <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-background"></span>
        </div>
        
        <div className="w-px h-6 bg-border mx-2 hidden sm:block"></div>

        <DropdownMenu>
          <DropdownMenuTrigger className="relative h-8 w-8 rounded-full ml-1 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <Avatar className="h-9 w-9 border border-border">
              <AvatarFallback className="bg-muted text-muted-foreground">U</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <div className="px-2 py-1.5 font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">User</p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <Link href="/settings" className="w-full">
              <DropdownMenuItem>Profile & Settings</DropdownMenuItem>
            </Link>
            <Link href="/login" className="w-full">
              <DropdownMenuItem>Log out</DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
