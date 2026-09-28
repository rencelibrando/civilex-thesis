"use client";

import { useState, useEffect, useRef } from "react";
import { User, Shield, Save, Loader2, Camera, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL } from "@/lib/config";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const ROLE_OPTIONS = [
  "Attorney / Litigation Practitioner",
  "In-House Counsel / Corporate",
  "Judiciary / Court Attorney",
  "Law Student / Bar Candidate",
  "Legal Researcher / Paralegal",
  "Law Faculty / Professor",
  "Government Legal Officer",
  "Normal Citizen / General Public",
  "Other Legal Professional"
];

const PRACTICE_AREAS = [
  "Civil Law & Obligations",
  "Persons & Family Relations",
  "Property, Ownership & Land Titles",
  "Torts & Damages",
  "Commercial & Corporate Law",
  "Labor & Employment",
  "General Civil Practice",
  "Pre-Bar / Academic Curriculum"
];

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [organization, setOrganization] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "updating" | "saved" | "error">("idle");
  const [passwordMessage, setPasswordMessage] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        
        setEmail(session.user.email || "");

        const res = await fetch(`${BACKEND_URL}/api/profiles/me`, {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          setName(data.full_name || session.user.user_metadata?.full_name || "");
          setRole(data.role || session.user.user_metadata?.role || "");
          setOrganization(data.organization || session.user.user_metadata?.organization || "");
          setPracticeArea(data.practice_area || session.user.user_metadata?.practice_area || "");
          setPhoneNumber(data.phone_number || session.user.user_metadata?.phone_number || "");
          setAvatarUrl(data.avatar_url || session.user.user_metadata?.avatar_url || null);
        } else {
          setName(session.user.user_metadata?.full_name || "");
          setRole(session.user.user_metadata?.role || "");
          setOrganization(session.user.user_metadata?.organization || "");
          setPracticeArea(session.user.user_metadata?.practice_area || "");
          setPhoneNumber(session.user.user_metadata?.phone_number || "");
          setAvatarUrl(session.user.user_metadata?.avatar_url || null);
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

        const res = await fetch(`${BACKEND_URL}/api/profiles/me/avatar`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        });

        if (res.ok) {
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
        await fetch(`${BACKEND_URL}/api/profiles/me`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ avatar_url: newAvatarUrl }),
        });
      }

      if (newAvatarUrl) {
        setAvatarUrl(newAvatarUrl);
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

      const res = await fetch(`${BACKEND_URL}/api/profiles/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ avatar_url: null }),
      });

      if (res.ok) {
        setAvatarUrl(null);
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

      const res = await fetch(`${BACKEND_URL}/api/profiles/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          full_name: name,
          role: role,
          organization: organization,
          practice_area: practiceArea,
          phone_number: phoneNumber
        })
      });

      if (res.ok) {
        await supabase.auth.updateUser({
          data: {
            full_name: name,
            role: role,
            organization: organization,
            practice_area: practiceArea,
            phone_number: phoneNumber
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
    if (newPassword.length < 6) {
      setPasswordStatus("error");
      setPasswordMessage("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordMessage("Passwords do not match.");
      return;
    }

    setPasswordStatus("updating");
    setPasswordMessage("");

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        setPasswordStatus("error");
        setPasswordMessage(error.message);
      } else {
        setPasswordStatus("saved");
        setPasswordMessage("Password successfully updated.");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => {
          setPasswordStatus("idle");
          setPasswordMessage("");
        }, 3000);
      }
    } catch (err) {
      setPasswordStatus("error");
      setPasswordMessage("Failed to update password. Please try again.");
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-4xl 2xl:max-w-5xl 3xl:max-w-6xl mx-auto space-y-4 sm:space-y-6 2xl:space-y-8 animate-fade-in pb-8 sm:pb-12 px-1 sm:px-2">
        <div>
          <h1 className="text-xl sm:text-2xl 2xl:text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Manage your personal profile, legal specialization, and account credentials.
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
              Update your photo, professional title, legal affiliation, and contact details.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-border">
              <div className="relative group shrink-0">
                <Avatar className="size-24 border-2 border-border shadow-sm ring-4 ring-card overflow-hidden">
                  <AvatarImage src={avatarUrl || undefined} alt={name || "User"} />
                  <AvatarFallback className="text-2xl font-semibold bg-accent text-accent-foreground">
                    {name ? name.charAt(0).toUpperCase() : 'U'}
                  </AvatarFallback>
                </Avatar>
                {isUploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-full backdrop-blur-xs">
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
                    className={`text-xs mt-0.5 font-medium ${
                      avatarFeedback.type === "error"
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {avatarFeedback.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Supported formats: JPG, PNG, WEBP, GIF. Max file size: 5MB.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Full Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Full Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Atty. Juan Dela Cruz"
                  className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                />
              </div>

              {/* Role / Job Title */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Role / Professional Title</label>
                <Input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  list="roles-list"
                  placeholder="e.g. Attorney / Normal Citizen / Law Student"
                  className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                />
                <datalist id="roles-list">
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>
              </div>

              {/* Organization / Law Firm / Law School */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Firm / Law School / Agency</label>
                <Input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. SyCip Law / UP College of Law"
                  className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                />
              </div>

              {/* Primary Practice Area / Field of Specialization */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Primary Legal Field / Focus</label>
                <Input
                  value={practiceArea}
                  onChange={(e) => setPracticeArea(e.target.value)}
                  list="practice-areas-list"
                  placeholder="e.g. Civil Law & Obligations / General Civil Practice"
                  className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                />
                <datalist id="practice-areas-list">
                  {PRACTICE_AREAS.map((opt) => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>
              </div>

              {/* Phone / Contact Number */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Contact Number</label>
                <Input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+63 917 123 4567"
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
              {saveStatus === "idle" && <span>Save updates made to your personal details, role, and organization.</span>}
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
              Update your account login password.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">New Password</label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Confirm New Password</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                    className="bg-background/60 dark:bg-background/40 border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl h-10 transition-colors"
                  />
                </div>
              </div>

              {passwordMessage && (
                <div className={`text-xs font-medium ${passwordStatus === "saved" ? "text-emerald-500" : "text-destructive"}`}>
                  {passwordMessage}
                </div>
              )}

              <Button
                type="submit"
                disabled={passwordStatus === "updating" || !newPassword}
                variant="outline"
                className="text-primary border-primary/30 hover:bg-primary/10 rounded-xl cursor-pointer"
              >
                {passwordStatus === "updating" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating Password...
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
      </div>
    </div>
  );
}
