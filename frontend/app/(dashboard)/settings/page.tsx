"use client";

import { useState, useEffect, useRef } from "react";
import { User, Shield, Save, Loader2, Camera, Trash2, KeyRound, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage, normalizeAvatarSrc } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase, signOutUser } from "@/lib/supabase";
import { BACKEND_URL, apiUrl } from "@/lib/config";
import { getCachedProfile, saveCachedProfile } from "@/lib/auth-storage";
import { validatePassword } from "@/lib/password-policy";
import { PasswordChecklist } from "@/components/auth/password-checklist";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change state (requires current password verification)
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "updating" | "saved" | "error">("idle");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isNewPasswordFocused, setIsNewPasswordFocused] = useState(false);

  // Delete account state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        setUserId(session.user.id);
        setEmail(session.user.email || "");

        const metaAvatar =
          session.user.user_metadata?.avatar_url ||
          session.user.user_metadata?.picture ||
          null;

        // Step 1: 0ms instant hydration from device cache strictly for this user
        const cached = getCachedProfile(session.user.id);
        if (cached && cached.id === session.user.id) {
          setName(cached.full_name || session.user.user_metadata?.full_name || "");
          setAvatarUrl(cached.avatar_url || metaAvatar);
          setIsLoading(false);
        }

        // Step 2: Background revalidation
        const primaryUrl = apiUrl("/api/profiles/me");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        let res = await fetch(primaryUrl, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeoutId);

        if (!res?.ok && primaryUrl !== "/api/profiles/me") {
          res = await fetch("/api/profiles/me", {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            cache: "no-store",
          }).catch(() => null);
        }

        if (res && res.ok) {
          const data = await res.json();
          // Strictly reject cross-user responses
          if (data && data.id && data.id !== session.user.id) {
            console.warn("[Settings] Cross-user profile response rejected:", data.id, "expected:", session.user.id);
            return;
          }

          setName(data.full_name || session.user.user_metadata?.full_name || "");
          const resolvedAvatar = data.avatar_url || metaAvatar;
          setAvatarUrl(resolvedAvatar);

          saveCachedProfile(session.user.id, {
            id: session.user.id,
            full_name: data.full_name,
            avatar_url: resolvedAvatar,
            email: session.user.email,
          });
        } else if (!cached || cached.id !== session.user.id) {
          setName(session.user.user_metadata?.full_name || "");
          setAvatarUrl(metaAvatar);
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

    if (!file.type.startsWith("image/")) {
      setAvatarFeedback({ type: "error", message: "Please select an image file (JPEG, PNG, WEBP, GIF)." });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarFeedback({ type: "error", message: "Image size must be less than 5MB." });
      return;
    }

    setIsUploadingAvatar(true);
    setAvatarFeedback(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAvatarFeedback({ type: "error", message: "Please sign in to update your profile photo." });
        return;
      }

      let newAvatarUrl: string | null = null;

      // Strategy 1: Upload via backend endpoint (bypasses browser client RLS issues)
      try {
        const formData = new FormData();
        formData.append("avatar", file);

        const uploadUrl = apiUrl("/api/profiles/me/avatar");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        let res = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeoutId);

        if (!res?.ok && uploadUrl !== "/api/profiles/me/avatar") {
          res = await fetch('/api/profiles/me/avatar', {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            body: formData,
          }).catch(() => null);
        }

        if (res && res.ok) {
          const data = await res.json();
          if (data.avatar_url) {
            newAvatarUrl = data.avatar_url;
          }
        }
      } catch (backendErr) {
        console.warn("Backend avatar upload failed, falling back to direct storage:", backendErr);
      }

      // Strategy 2 (Fallback): Direct Supabase storage upload
      if (!newAvatarUrl) {
        const userId = session.user.id;
        const ext = file.name.split(".").pop() || "png";
        const filePath = `${userId}/avatar.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(filePath, file, { upsert: true, contentType: file.type });

        if (uploadError) {
          throw new Error(uploadError.message || "Failed to upload image to storage.");
        }

        const { data: urlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(filePath);

        newAvatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

        // Save to backend profiles
        const patchUrl = apiUrl("/api/profiles/me");
        await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ avatar_url: newAvatarUrl }),
        }).catch(() => fetch('/api/profiles/me', {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ avatar_url: newAvatarUrl }),
        }));
      }

      if (newAvatarUrl) {
        setAvatarUrl(newAvatarUrl);
        saveCachedProfile(session.user.id, { avatar_url: newAvatarUrl });
        await supabase.auth.updateUser({
          data: { avatar_url: newAvatarUrl },
        });
        window.dispatchEvent(new Event("profile-updated"));
        setAvatarFeedback({ type: "success", message: "Profile photo updated successfully!" });
      } else {
        throw new Error("Unable to save photo. Please try again.");
      }
    } catch (err: any) {
      console.error("Failed to upload avatar", err);
      setAvatarFeedback({
        type: "error",
        message: err.message || "Failed to upload avatar. Please try again.",
      });
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setIsUploadingAvatar(true);
      setAvatarFeedback(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const removeUrl = apiUrl("/api/profiles/me");
      let res = await fetch(removeUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ avatar_url: null }),
      }).catch(() => null);

      if (!res?.ok && removeUrl !== "/api/profiles/me") {
        res = await fetch('/api/profiles/me', {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ avatar_url: null }),
        }).catch(() => null);
      }

      if (res && res.ok) {
        setAvatarUrl(null);
        saveCachedProfile(session.user.id, { avatar_url: null });
        await supabase.auth.updateUser({
          data: { avatar_url: null },
        });
        window.dispatchEvent(new Event("profile-updated"));
        setAvatarFeedback({ type: "success", message: "Profile photo removed." });
      }
    } catch (err: any) {
      console.error("Failed to remove avatar", err);
      setAvatarFeedback({ type: "error", message: "Failed to remove photo." });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const saveUrl = apiUrl("/api/profiles/me");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      let res = await fetch(saveUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          full_name: name,
        }),
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (!res?.ok && saveUrl !== "/api/profiles/me") {
        res = await fetch('/api/profiles/me', {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            full_name: name,
          })
        }).catch(() => null);
      }

      if (res && res.ok) {
        saveCachedProfile(session.user.id, {
          full_name: name,
        });
        await supabase.auth.updateUser({
          data: {
            full_name: name,
          }
        });
        window.dispatchEvent(new Event("profile-updated"));
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

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordStatus("error");
      setPasswordMessage("Please enter your current password.");
      return;
    }
    const policyError = validatePassword(newPassword);
    if (policyError) {
      setPasswordStatus("error");
      setPasswordMessage(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordMessage("New passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordStatus("error");
      setPasswordMessage("New password must be different from your current password.");
      return;
    }

    setPasswordStatus("updating");
    setPasswordMessage("");

    try {
      // 1. Verify current password by signing in with active account email
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || email;
      if (!userEmail) {
        throw new Error("Unable to identify current account email. Please refresh and try again.");
      }

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (verifyError) {
        setPasswordStatus("error");
        setPasswordMessage("Current password is incorrect. Please try again.");
        return;
      }

      // 2. Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordStatus("error");
        setPasswordMessage(updateError.message || "Failed to update password.");
        return;
      }

      setPasswordStatus("saved");
      setPasswordMessage("Password successfully updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setPasswordStatus("idle");
        setPasswordMessage("");
      }, 3500);
    } catch (err: unknown) {
      setPasswordStatus("error");
      setPasswordMessage(err instanceof Error ? err.message : "Failed to update password. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setIsDeletingAccount(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("No active session found. Please sign in again.");
      }
      const response = await fetch(apiUrl("/api/profiles/me"), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to delete account.");
      }
      await signOutUser("Your account has been permanently deleted.");
      window.location.href = "/login?deleted=true";
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account. Please try again.");
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto overscroll-contain custom-scrollbar">
      <div className="w-full max-w-4xl 2xl:max-w-5xl 3xl:max-w-6xl mx-auto space-y-4 sm:space-y-6 2xl:space-y-8 animate-fade-in pb-2 px-1 sm:px-2">
        <div>
          <h1 className="text-xl sm:text-2xl 2xl:text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Manage your personal profile and account credentials.
          </p>
        </div>

        {/* Section 1: Personal Information */}
        <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border px-4 py-3.5 sm:px-6 sm:py-4">
            <CardTitle className="flex items-center gap-2 text-foreground font-semibold text-base sm:text-lg">
              <User className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              Personal Information
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs sm:text-sm">
              Update your photo and display name.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-border">
              <div className="relative group shrink-0">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(true)}
                  className="relative block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-transform active:scale-95 cursor-pointer group/avatarBtn"
                  title="Click to preview your profile photo"
                  aria-label="Click to preview your profile photo"
                >
                  <Avatar className="size-24 border-2 border-border shadow-sm ring-4 ring-card overflow-hidden group-hover/avatarBtn:ring-primary/40 transition-all duration-300">
                    <AvatarImage src={avatarUrl || undefined} alt={name || "User"} />
                    <AvatarFallback className="text-2xl font-semibold bg-accent text-accent-foreground">
                      {name ? name.charAt(0).toUpperCase() : 'U'}
                    </AvatarFallback>
                  </Avatar>

                  {/* Hover preview overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover/avatarBtn:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center text-white backdrop-blur-[1.5px]">
                    <Eye className="w-5 h-5 text-white drop-shadow-sm mb-0.5" />
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-white/90 drop-shadow-xs">Preview</span>
                  </div>
                </button>

                {isUploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-full backdrop-blur-xs pointer-events-none z-10">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center sm:items-start gap-2">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
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
                    disabled={!avatarUrl || isUploadingAvatar}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remove
                  </Button>
                </div>
                {avatarFeedback && (
                  <p
                    className={`text-xs mt-0.5 font-medium ${avatarFeedback.type === "error"
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400"
                      }`}
                  >
                    {avatarFeedback.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Click your photo to preview. Supported formats: JPG, PNG, WEBP, GIF (Max 5MB).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Username */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Username</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                />
              </div>

              {/* Email Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Email Address</label>
                  <span className="text-[11px] text-muted-foreground">Managed by auth provider</span>
                </div>
                <Input
                  type="email"
                  value={email}
                  className="bg-background/30 dark:bg-background/20 border-border/50 text-muted-foreground cursor-not-allowed rounded-xl h-10"
                  disabled
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t border-border px-6 py-4 flex items-center justify-between bg-card/50">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {saveStatus === "saved" && <span className="text-emerald-500 font-medium">✓ Personal information saved successfully</span>}
              {saveStatus === "error" && <span className="text-destructive font-medium">✕ Failed to save changes</span>}
              {saveStatus === "idle" && <span>Save updates made to your display name.</span>}
            </div>
            <Button onClick={handleSave} disabled={saveStatus === "saving"} className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 px-5 rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-95 cursor-pointer">
              {saveStatus === "saving" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Changes
            </Button>
          </CardFooter>
        </Card>

        {/* Section 2: Change Password */}
        <Card className="bg-card border border-border shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border px-6 py-5">
            <CardTitle className="flex items-center gap-2 text-foreground font-semibold">
              <Shield className="w-5 h-5 text-primary" />
              Change Password
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Update your account password. For security, please enter your current password to authorize changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-xl">
              {/* Current Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Current Password</label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    required
                    disabled={passwordStatus === "updating"}
                    className="pr-10 bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                    tabIndex={-1}
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New Password & Confirm */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">New Password</label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      onFocus={() => setIsNewPasswordFocused(true)}
                      onBlur={(e) => {
                        if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
                          setIsNewPasswordFocused(false);
                        }
                      }}
                      placeholder="Create a strong password"
                      required
                      disabled={passwordStatus === "updating"}
                      aria-describedby={isNewPasswordFocused || newPassword.length > 0 ? "settings-password-requirements" : undefined}
                      className="pr-10 bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                      tabIndex={-1}
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Confirm New Password</label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      disabled={passwordStatus === "updating"}
                      className="pr-10 bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <PasswordChecklist
                id="settings-password-requirements"
                password={newPassword}
                visible={isNewPasswordFocused || newPassword.length > 0}
              />

              {passwordMessage && (
                <div className={`text-xs font-medium ${passwordStatus === "saved" ? "text-emerald-500" : "text-destructive"}`}>
                  {passwordMessage}
                </div>
              )}

              <Button
                type="submit"
                disabled={passwordStatus === "updating" || !currentPassword || !newPassword || !confirmPassword}
                variant="outline"
                className="text-primary border-primary/30 hover:bg-primary/10 rounded-xl cursor-pointer"
              >
                {passwordStatus === "updating" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying & Updating...
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4 mr-2" />
                    Update Password
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Section 3: Danger Zone / Delete Account */}
        <Card className="bg-destructive/5 border border-destructive/20 shadow-xs rounded-xl p-3 sm:p-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-destructive">Danger Zone</span>
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">•</span>
                  <span className="text-xs font-medium text-foreground hidden sm:inline">Delete Account</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Permanently delete your account and all associated research data.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setDeleteConfirmText("");
                setDeleteError("");
                setIsDeleteDialogOpen(true);
              }}
              className="rounded-lg h-7 px-2.5 text-[11px] font-medium shrink-0 cursor-pointer shadow-xs active:scale-95 transition-all self-end sm:self-center"
            >
              <Trash2 className="w-3 h-3 mr-1.5" />
              Delete Account
            </Button>
          </div>
        </Card>

        {/* Delete Account Confirmation Modal */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-card border-border shadow-2xl rounded-2xl">
            <DialogHeader className="p-5 pb-3 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-destructive/10 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-destructive">Delete Account Confirmation</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    This action is permanent and cannot be undone
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                You are about to permanently delete the account registered to <strong className="text-foreground">{email}</strong>. All of your research sessions, briefings, and profile credentials will be deleted permanently.
              </p>

              <div className="space-y-1.5 bg-destructive/10 p-3.5 rounded-xl border border-destructive/20 text-destructive text-xs">
                <p className="font-semibold">To confirm, please type <span className="underline font-mono">DELETE</span> below:</p>
                <Input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE to confirm"
                  className="h-9 text-xs bg-background/80 border-destructive/30 focus-visible:ring-destructive/30 rounded-lg text-foreground mt-2 font-mono"
                />
              </div>

              {deleteError && (
                <div className="text-xs text-destructive font-medium">
                  {deleteError}
                </div>
              )}
            </div>

            <DialogFooter className="p-4 bg-muted/30 border-t border-border flex flex-row items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl text-xs h-9 cursor-pointer"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeletingAccount}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="rounded-xl text-xs h-9 px-4 font-semibold cursor-pointer"
                disabled={deleteConfirmText !== "DELETE" || isDeletingAccount}
                onClick={handleDeleteAccount}
              >
                {isDeletingAccount ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Deleting Account...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Permanently Delete
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Profile Picture Pop-Up Preview Modal */}
        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-card/95 backdrop-blur-md border-border shadow-2xl rounded-2xl">
            <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-foreground">Profile Picture Preview</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    {name ? name : "Your profile avatar"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="p-6 flex flex-col items-center justify-center bg-muted/20">
              <div className="relative group/modalAvatar w-60 h-60 sm:w-72 sm:h-72 rounded-2xl overflow-hidden border-2 border-border/80 shadow-md bg-background flex items-center justify-center">
                {avatarUrl ? (
                  <img
                    src={normalizeAvatarSrc(avatarUrl) || (userId ? `/api/profiles/avatar/${userId}` : undefined)}
                    alt={name || "Profile Picture"}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover/modalAvatar:scale-105"
                    onError={(e) => {
                      if (userId && !e.currentTarget.src.includes('/api/profiles/avatar')) {
                        e.currentTarget.src = `/api/profiles/avatar/${userId}`;
                      }
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
                    <div className="w-24 h-24 rounded-full bg-primary/10 text-primary flex items-center justify-center text-4xl font-bold border border-primary/20 shadow-sm">
                      {name ? name.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{name || "Default Avatar"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">No custom profile photo uploaded yet.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 text-center">
                <h3 className="text-sm font-semibold text-foreground">{name || "CIVIL-LEX User"}</h3>
                {email && <p className="text-xs text-muted-foreground mt-0.5">{email}</p>}
              </div>
            </div>

            <DialogFooter className="p-3.5 sm:p-4 bg-muted/40 border-t border-border flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-9 cursor-pointer"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setIsPreviewOpen(false);
                  }}
                  disabled={isUploadingAvatar}
                >
                  <Camera className="w-3.5 h-3.5 mr-1.5" />
                  Change Photo
                </Button>
                {avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl text-xs h-9 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                    onClick={async () => {
                      await handleRemoveAvatar();
                      setIsPreviewOpen(false);
                    }}
                    disabled={isUploadingAvatar}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Remove
                  </Button>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-xl text-xs h-9 px-4 cursor-pointer"
                onClick={() => setIsPreviewOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
