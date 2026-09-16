"use client";

import { useState, useEffect, useRef } from "react";
import { User, Bell, Shield, Moon, Sun, Monitor, Save, Loader2, Camera, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        
        setEmail(session.user.email || "");

        const res = await fetch("http://localhost:4000/api/profiles/me", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          setName(data.full_name || "");
          setAvatarUrl(data.avatar_url || null);
          setEmailAlerts(data.notification_preferences?.email ?? true);
          setPushAlerts(data.notification_preferences?.push ?? false);
        }
      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const userId = session.user.id;
      const ext = file.name.split(".").pop() || "png";
      const filePath = `${userId}/avatar.${ext}`;

      // Upload to avatars bucket
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        console.error("Avatar upload error:", uploadError);
        return;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const newAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      // Update profile with new avatar URL
      const res = await fetch("http://localhost:4000/api/profiles/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ avatar_url: newAvatarUrl })
      });

      if (res.ok) {
        setAvatarUrl(newAvatarUrl);
      }
    } catch (err) {
      console.error("Failed to upload avatar", err);
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("http://localhost:4000/api/profiles/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ avatar_url: null })
      });

      if (res.ok) {
        setAvatarUrl(null);
      }
    } catch (err) {
      console.error("Failed to remove avatar", err);
    }
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("http://localhost:4000/api/profiles/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          full_name: name,
          notification_preferences: {
            email: emailAlerts,
            push: pushAlerts
          }
        })
      });

      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch (err) {
      console.error("Failed to save profile", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const themeOptions = [
    { value: "system", label: "System", icon: Monitor, description: "Follow your device settings" },
    { value: "dark", label: "Dark", icon: Moon, description: "Easier on the eyes" },
    { value: "light", label: "Light", icon: Sun, description: "Classic bright mode" },
  ] as const;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your account settings and application preferences.</p>
        </div>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-muted/60 dark:bg-card/60 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-xs">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          {/* Profile Settings */}
          <TabsContent value="profile" className="mt-6 space-y-6 flex-none">
            <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden h-fit">
              <CardHeader className="border-b border-border px-6 py-5">
                <CardTitle className="flex items-center gap-2 text-foreground font-semibold">
                  <User className="w-5 h-5 text-primary" />
                  Personal Information
                </CardTitle>
                <CardDescription className="text-muted-foreground">Update your photo and personal details here.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-border">
                  <div className="relative group">
                    <Avatar className="w-24 h-24 border-2 border-border shadow-sm ring-4 ring-card">
                      <AvatarImage src={avatarUrl || undefined} alt={name || "User"} />
                      <AvatarFallback className="text-2xl font-semibold bg-accent text-accent-foreground">{name ? name.charAt(0).toUpperCase() : 'U'}</AvatarFallback>
                    </Avatar>
                    {isUploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-full backdrop-blur-xs">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleAvatarUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      className="border-border text-foreground hover:bg-accent/50 rounded-xl cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingAvatar}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      {isUploadingAvatar ? "Uploading..." : "Change Photo"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl cursor-pointer"
                      onClick={handleRemoveAvatar}
                      disabled={!avatarUrl}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Full Name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your full name"
                      className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Role / Job Title</label>
                    <Input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="e.g. Attorney / Legal Researcher"
                      className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">Email Address</label>
                      <span className="text-[11px] text-muted-foreground">Managed by auth provider</span>
                    </div>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-background/30 dark:bg-background/20 border-border/50 text-muted-foreground cursor-not-allowed rounded-xl h-10"
                      disabled
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border px-6 py-4 flex items-center justify-between bg-card/50">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  {saveStatus === "saved" && <span className="text-emerald-500 font-medium">✓ Changes saved successfully</span>}
                  {saveStatus === "error" && <span className="text-destructive font-medium">✕ Failed to save changes</span>}
                  {saveStatus === "idle" && <span>Save any updates made to your profile details.</span>}
                </div>
                <Button onClick={handleSave} disabled={saveStatus === "saving"} className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 px-5 rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-95 cursor-pointer">
                  {saveStatus === "saving" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Changes
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* Preferences */}
          <TabsContent value="preferences" className="mt-6 space-y-6 flex-none">
            <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden h-fit">
              <CardHeader className="border-b border-border px-6 py-5">
                <CardTitle className="flex items-center gap-2 text-foreground font-semibold">
                  <Monitor className="w-5 h-5 text-primary" />
                  Appearance
                </CardTitle>
                <CardDescription className="text-muted-foreground">Customize how CIVIL-LEX looks on your device.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {themeOptions.map((opt) => {
                    const isActive = theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setTheme(opt.value)}
                        className={`border-2 rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200 ${
                          isActive
                            ? 'border-primary bg-primary/10 dark:bg-primary/15 shadow-sm'
                            : 'border-border bg-background/50 dark:bg-background/30 hover:bg-accent/40 hover:border-border'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-xs ${
                          isActive ? 'bg-primary/20 text-primary' : 'bg-accent/60 text-muted-foreground'
                        }`}>
                          <opt.icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <span className={`font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-6 space-y-6 flex-none">
            <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden h-fit">
              <CardHeader className="border-b border-border px-6 py-5">
                <CardTitle className="flex items-center gap-2 text-foreground font-semibold">
                  <Bell className="w-5 h-5 text-primary" />
                  Notification Preferences
                </CardTitle>
                <CardDescription className="text-muted-foreground">Choose what updates you want to receive.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6 divide-y divide-border">
                <div className="flex items-center justify-between pb-4">
                  <div>
                    <h4 className="font-medium text-foreground">Email Alerts</h4>
                    <p className="text-sm text-muted-foreground">Receive summaries of long-running legal research.</p>
                  </div>
                  <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
                </div>
                <div className="flex items-center justify-between py-4">
                  <div>
                    <h4 className="font-medium text-foreground">Jurisprudence Updates</h4>
                    <p className="text-sm text-muted-foreground">Get notified when new Supreme Court cases match your recent queries.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between pt-4">
                  <div>
                    <h4 className="font-medium text-foreground">Marketing Communications</h4>
                    <p className="text-sm text-muted-foreground">Receive news about CIVIL-LEX features and updates.</p>
                  </div>
                  <Switch />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="mt-6 space-y-6 flex-none">
            <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden h-fit">
              <CardHeader className="border-b border-border px-6 py-5">
                <CardTitle className="flex items-center gap-2 text-foreground font-semibold">
                  <Shield className="w-5 h-5 text-primary" />
                  Security Settings
                </CardTitle>
                <CardDescription className="text-muted-foreground">Manage your password and security options.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="space-y-4">
                  <h4 className="font-medium text-foreground">Change Password</h4>
                  <div className="space-y-4 max-w-xl">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Current Password</label>
                      <Input
                        type="password"
                        placeholder="Enter your current password"
                        className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">New Password</label>
                        <Input
                          type="password"
                          placeholder="Enter new password"
                          className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Confirm New Password</label>
                        <Input
                          type="password"
                          placeholder="Confirm new password"
                          className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                        />
                      </div>
                    </div>
                    <Button variant="outline" className="text-primary border-primary/30 hover:bg-primary/10 rounded-xl cursor-pointer">Update Password</Button>
                  </div>
                </div>

                <div className="pt-6 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-foreground">Two-Factor Authentication</h4>
                      <p className="text-sm text-muted-foreground">Add an extra layer of security to your account.</p>
                    </div>
                    <Button variant="secondary" className="bg-accent text-accent-foreground hover:bg-accent/80 rounded-xl cursor-pointer">Enable</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
