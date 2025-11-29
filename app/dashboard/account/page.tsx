"use client";

import { createClient } from "@/lib/supabase/client";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { Toaster } from "react-hot-toast";
import { useEffect, useState } from "react";
import { User, Mail, Lock, Bell, Globe, Trash2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function AccountPage() {
  const [, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState({
    emailNotifications: true,
    pushNotifications: false,
    language: "en",
    timezone: "UTC",
    theme: "dark"
  });
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getClaims();
      
      if (error || !data?.claims) {
        window.location.href = "/auth/login";
        return;
      }
      
      setUserId(data.claims.sub);
      
      // Get user email
      const { data: userData } = await supabase.auth.getUser();
      setUserEmail(userData.user?.email || null);
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      toast.error("Error signing out");
    } else {
      toast.success("Signed out successfully");
      router.push("/");
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      // In a real app, you'd implement account deletion logic here
      toast.error("Account deletion not implemented yet");
    }
  };

  const handleSaveSettings = () => {
    // In a real app, you'd save settings to the database
    toast.success("Settings saved successfully");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex items-center justify-center">
        <div className="text-[hsl(var(--tech-text-primary))]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--tech-bg))] flex">
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'hsl(var(--tech-bg-secondary))',
            color: 'hsl(var(--tech-text-primary))',
            border: '1px solid hsl(var(--tech-border))',
          },
        }}
      />
      
      {/* Sidebar */}
      <DashboardSidebar className="flex-shrink-0" />
      
      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-[hsl(var(--tech-bg))]">
        <div className="h-full overflow-y-auto">
          <div className="p-8">
            <div className="max-w-4xl mx-auto">
              <div className="flex flex-col gap-8">
                {/* Header */}
                <div>
                  <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">Account Settings</h1>
                  <p className="text-[hsl(var(--tech-text-secondary))]">Manage your account preferences and security settings</p>
                </div>

                {/* Profile Section */}
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-[hsl(var(--tech-accent))] to-[hsl(var(--tech-accent-hover))] rounded-full flex items-center justify-center">
                      <User className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[hsl(var(--tech-text-primary))]">Profile Information</h2>
                      <p className="text-[hsl(var(--tech-text-secondary))]">Update your account details</p>
                    </div>
                  </div>
                  
                  <div className="grid gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[hsl(var(--tech-text-primary))] mb-2">
                        <Mail className="inline h-4 w-4 mr-2" />
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={userEmail || ""}
                        disabled
                        className="w-full px-3 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] opacity-50 cursor-not-allowed"
                      />
                      <p className="text-xs text-[hsl(var(--tech-text-muted))] mt-1">Email cannot be changed</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-[hsl(var(--tech-text-primary))] mb-2">
                        <Lock className="inline h-4 w-4 mr-2" />
                        Password
                      </label>
                      <button className="px-4 py-2 bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-white rounded-lg transition-colors">
                        Change Password
                      </button>
                    </div>
                  </div>
                </div>

                {/* Notification Settings */}
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <Bell className="h-6 w-6 text-[hsl(var(--tech-accent))]" />
                    <div>
                      <h2 className="text-xl font-semibold text-[hsl(var(--tech-text-primary))]">Notifications</h2>
                      <p className="text-[hsl(var(--tech-text-secondary))]">Manage how you receive notifications</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-[hsl(var(--tech-text-primary))]">Email Notifications</h3>
                        <p className="text-sm text-[hsl(var(--tech-text-secondary))]">Receive updates via email</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.emailNotifications}
                          onChange={(e) => setSettings({...settings, emailNotifications: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-[hsl(var(--tech-bg-tertiary))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[hsl(var(--tech-accent))]"></div>
                      </label>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-[hsl(var(--tech-text-primary))]">Push Notifications</h3>
                        <p className="text-sm text-[hsl(var(--tech-text-secondary))]">Receive browser notifications</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.pushNotifications}
                          onChange={(e) => setSettings({...settings, pushNotifications: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-[hsl(var(--tech-bg-tertiary))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[hsl(var(--tech-accent))]"></div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Preferences */}
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <Globe className="h-6 w-6 text-[hsl(var(--tech-accent))]" />
                    <div>
                      <h2 className="text-xl font-semibold text-[hsl(var(--tech-text-primary))]">Preferences</h2>
                      <p className="text-[hsl(var(--tech-text-secondary))]">Customize your app experience</p>
                    </div>
                  </div>
                  
                  <div className="grid gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[hsl(var(--tech-text-primary))] mb-2">
                        Language
                      </label>
                      <select
                        value={settings.language}
                        onChange={(e) => setSettings({...settings, language: e.target.value})}
                        className="w-full px-3 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] focus:border-[hsl(var(--tech-accent))] focus:outline-none"
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-[hsl(var(--tech-text-primary))] mb-2">
                        Timezone
                      </label>
                      <select
                        value={settings.timezone}
                        onChange={(e) => setSettings({...settings, timezone: e.target.value})}
                        className="w-full px-3 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] focus:border-[hsl(var(--tech-accent))] focus:outline-none"
                      >
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">Eastern Time</option>
                        <option value="America/Chicago">Central Time</option>
                        <option value="America/Denver">Mountain Time</option>
                        <option value="America/Los_Angeles">Pacific Time</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-[hsl(var(--tech-text-primary))] mb-2">
                        Theme
                      </label>
                      <select
                        value={settings.theme}
                        onChange={(e) => setSettings({...settings, theme: e.target.value})}
                        className="w-full px-3 py-2 bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] focus:border-[hsl(var(--tech-accent))] focus:outline-none"
                      >
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    className="px-6 py-2 bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-white rounded-lg transition-colors font-medium"
                  >
                    Save Changes
                  </button>
                </div>

                {/* Danger Zone */}
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-danger))] border-opacity-30 rounded-xl p-6">
                  <h2 className="text-xl font-semibold text-[hsl(var(--tech-danger))] mb-4">Danger Zone</h2>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-[hsl(var(--tech-bg-tertiary))] rounded-lg">
                      <div>
                        <h3 className="font-medium text-[hsl(var(--tech-text-primary))]">Sign Out</h3>
                        <p className="text-sm text-[hsl(var(--tech-text-secondary))]">Sign out of your account</p>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--tech-danger))] hover:bg-red-600 text-white rounded-lg transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                    
                    <div className="flex items-center justify-between p-4 bg-[hsl(var(--tech-bg-tertiary))] rounded-lg">
                      <div>
                        <h3 className="font-medium text-[hsl(var(--tech-text-primary))]">Delete Account</h3>
                        <p className="text-sm text-[hsl(var(--tech-text-secondary))]">Permanently delete your account and all data</p>
                      </div>
                      <button
                        onClick={handleDeleteAccount}
                        className="flex items-center gap-2 px-4 py-2 bg-transparent border border-[hsl(var(--tech-danger))] text-[hsl(var(--tech-danger))] hover:bg-[hsl(var(--tech-danger))] hover:text-white rounded-lg transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete Account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}