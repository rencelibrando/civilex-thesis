"use client";

import { useState } from "react";
import { User, Bell, Shield, Moon, Monitor, Smartphone, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { userProfile } from "@/lib/mock-data";

export default function SettingsPage() {
  const [name, setName] = useState(userProfile.name);
  const [email, setEmail] = useState(userProfile.email);
  const [role, setRole] = useState(userProfile.role);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-[#334155]">Settings</h1>
        <p className="text-[#64748B] text-sm mt-1">Manage your account settings and application preferences.</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="profile" className="rounded-lg data-[state=active]:bg-slate-50 data-[state=active]:text-[#100771] data-[state=active]:shadow-sm">Profile</TabsTrigger>
          <TabsTrigger value="preferences" className="rounded-lg data-[state=active]:bg-slate-50 data-[state=active]:text-[#100771] data-[state=active]:shadow-sm">Preferences</TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-lg data-[state=active]:bg-slate-50 data-[state=active]:text-[#100771] data-[state=active]:shadow-sm">Notifications</TabsTrigger>
          <TabsTrigger value="security" className="rounded-lg data-[state=active]:bg-slate-50 data-[state=active]:text-[#100771] data-[state=active]:shadow-sm">Security</TabsTrigger>
        </TabsList>

        {/* Profile Settings */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="bg-[#FAFAFD] border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-[#100771]" />
                Personal Information
              </CardTitle>
              <CardDescription>Update your photo and personal details here.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-slate-100">
                <Avatar className="w-24 h-24 border-4 border-slate-50 shadow-sm">
                  <AvatarImage src={userProfile.avatar} />
                  <AvatarFallback className="text-2xl">JD</AvatarFallback>
                </Avatar>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button variant="outline" className="border-slate-200 text-[#334155] hover:bg-slate-50">Change Photo</Button>
                  <Button variant="ghost" className="text-slate-500 hover:text-red-600 hover:bg-red-50">Remove</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#334155]">Full Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#334155]">Email Address</label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#334155]">Role / Job Title</label>
                  <Input value={role} onChange={(e) => setRole(e.target.value)} className="bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" />
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-[#FAFAFD] border-t border-slate-100 px-6 py-4 justify-end">
              <Button className="bg-[#100771] hover:bg-[#170073] text-slate-50">
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Preferences */}
        <TabsContent value="preferences" className="mt-6 space-y-6">
          <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="bg-[#FAFAFD] border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-[#100771]" />
                Appearance
              </CardTitle>
              <CardDescription>Customize how CIVIL-LEX looks on your device.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border-2 border-[#100771] bg-[#F1F0FB] rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer">
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center shadow-sm">
                    <Monitor className="w-5 h-5 text-[#100771]" />
                  </div>
                  <span className="font-medium text-[#100771]">System</span>
                </div>
                <div className="border border-slate-200 bg-slate-50 hover:bg-slate-50 rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer transition-colors">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                    <Moon className="w-5 h-5 text-slate-500" />
                  </div>
                  <span className="font-medium text-[#334155]">Dark</span>
                </div>
                <div className="border border-slate-200 bg-slate-50 hover:bg-slate-50 rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer transition-colors">
                  <div className="w-12 h-12 rounded-full bg-yellow-50 flex items-center justify-center">
                    <div className="w-5 h-5 text-yellow-500 rounded-full border-2 border-yellow-500"></div>
                  </div>
                  <span className="font-medium text-[#334155]">Light</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="mt-6 space-y-6">
          <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="bg-[#FAFAFD] border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-[#100771]" />
                Notification Preferences
              </CardTitle>
              <CardDescription>Choose what updates you want to receive.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-[#334155]">Email Alerts</h4>
                  <p className="text-sm text-[#64748B]">Receive summaries of long-running legal research.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-[#334155]">Jurisprudence Updates</h4>
                  <p className="text-sm text-[#64748B]">Get notified when new Supreme Court cases match your recent queries.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-[#334155]">Marketing Communications</h4>
                  <p className="text-sm text-[#64748B]">Receive news about CIVIL-LEX features and updates.</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="bg-[#FAFAFD] border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#100771]" />
                Security Settings
              </CardTitle>
              <CardDescription>Manage your password and security options.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="font-medium text-[#334155]">Change Password</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input type="password" placeholder="Current Password" className="bg-slate-50" />
                  <div className="hidden sm:block"></div>
                  <Input type="password" placeholder="New Password" className="bg-slate-50" />
                  <Input type="password" placeholder="Confirm New Password" className="bg-slate-50" />
                </div>
                <Button variant="outline" className="mt-2 text-[#100771] border-[#100771]/20 hover:bg-[#F1F0FB]">Update Password</Button>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-[#334155]">Two-Factor Authentication</h4>
                    <p className="text-sm text-[#64748B]">Add an extra layer of security to your account.</p>
                  </div>
                  <Button variant="secondary" className="bg-[#F1F0FB] text-[#100771] hover:bg-[#e1def5]">Enable</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
