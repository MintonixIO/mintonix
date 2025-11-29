"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Home,
  BarChart3,
  FileText,
  User,
  Archive,
  CreditCard,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface DashboardSidebarProps {
  className?: string;
  refreshTrigger?: number;
}

interface UserData {
  email: string;
  fullName: string;
}

interface SubscriptionData {
  plan_type: string;
  minutes_included: number;
  minutes_used: number;
  minutes_remaining: number;
}

export function DashboardSidebar({ className, refreshTrigger }: DashboardSidebarProps) {
  const pathname = usePathname();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    setIsHydrated(true);
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved) {
      setIsCollapsed(JSON.parse(saved));
    }
  }, []);

  // Save state to localStorage whenever it changes (after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem('sidebarCollapsed', JSON.stringify(isCollapsed));
    }
  }, [isCollapsed, isHydrated]);

  // Fetch subscription data
  const fetchSubscription = async () => {
    try {
      console.log('[Sidebar] Fetching subscription...');
      const response = await fetch('/api/subscription');
      console.log('[Sidebar] Response status:', response.status, response.statusText);

      if (response.ok) {
        const subData = await response.json();
        console.log('[Sidebar] Raw subscription data:', subData);

        // Convert numeric strings to numbers for proper calculations
        const subscriptionData = {
          plan_type: subData.plan_type,
          minutes_included: Number(subData.minutes_included) || 0,
          minutes_used: Number(subData.minutes_used) || 0,
          minutes_remaining: Number(subData.minutes_remaining) || 0
        };

        console.log('[Sidebar] Parsed subscription data:', subscriptionData);
        console.log('[Sidebar] Progress bar width should be:',
          subscriptionData.minutes_included > 0
            ? (subscriptionData.minutes_used / subscriptionData.minutes_included) * 100
            : 0, '%');
        setSubscription(subscriptionData);
      } else {
        const errorData = await response.text();
        console.error('[Sidebar] Failed to fetch subscription:', response.status, errorData);
      }
    } catch (error) {
      console.error('[Sidebar] Error fetching subscription:', error);
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();

      if (data.user) {
        // Fetch user profile for full_name
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('full_name, email')
          .eq('id', data.user.id)
          .single();

        if (profile) {
          setUserData({
            email: profile.email || data.user.email || '',
            fullName: profile.full_name || profile.email?.split('@')[0] || 'User'
          });
        }

        // Fetch subscription data
        await fetchSubscription();
      }
    };
    fetchUserData();
  }, []);

  // Refresh subscription when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      console.log('Refresh trigger changed, fetching subscription...', refreshTrigger);
      fetchSubscription();
    }
  }, [refreshTrigger]);

  const navigationItems = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: Home,
      description: "Overview and videos"
    },
    {
      name: "Analytics",
      href: "/dashboard/analytics",
      icon: BarChart3,
      description: "Performance insights"
    },
    {
      name: "Video Archive",
      href: "/dashboard/archive",
      icon: Archive,
      description: "Archived videos"
    },
    {
      name: "Reports",
      href: "/dashboard/reports",
      icon: FileText,
      description: "Analysis reports"
    }
  ];

  const bottomItems = [
    {
      name: "Billing",
      href: "/dashboard/billing",
      icon: CreditCard,
      description: "Manage subscription"
    }
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
      <>
        {/* Sidebar Container - Takes up space in layout and maintains full height */}
        <div
            className={`flex flex-col bg-[hsl(var(--tech-bg-secondary))] border-r border-[hsl(var(--tech-border))] transition-all duration-300 ease-in-out ${
                isCollapsed ? 'w-16' : 'w-64'
            } ${className}`}
            style={{
              width: isCollapsed ? '4rem' : '16rem',
              height: '100vh',
              position: 'sticky',
              top: 0,
            }}
        >
          {/* Collapse Toggle */}
          <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="absolute -right-3 top-6 z-50 w-6 h-6 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-full flex items-center justify-center hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200"
          >
            {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-[hsl(var(--tech-text-secondary))]" />
            ) : (
                <ChevronLeft className="h-3 w-3 text-[hsl(var(--tech-text-secondary))]" />
            )}
          </button>

          {/* Logo */}
          <div className={`p-6 border-b border-[hsl(var(--tech-border))] flex-shrink-0 ${isCollapsed ? 'px-4' : 'px-6'}`}>
            <Link href="/" className={`flex items-center group ${isCollapsed ? 'justify-center' : 'space-x-3'}`}>
              <div className="relative">
                <Image
                    src="/logo-notext-nobg.svg"
                    alt="Mintonix Logo"
                    width={32}
                    height={32}
                    className="w-8 h-8 object-contain transition-transform group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--tech-accent))] to-transparent opacity-0 group-hover:opacity-20 rounded-lg transition-opacity"></div>
              </div>
              <span
                  className={`font-bold text-xl text-[hsl(var(--tech-text-primary))] group-hover:text-[hsl(var(--tech-accent))] transition-all duration-300 overflow-hidden whitespace-nowrap ${
                      isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100 ml-3'
                  }`}
              >
              Mintonix
            </span>
            </Link>
          </div>

          {/* Main Navigation */}
          <div className="flex-1 overflow-y-auto">
            <nav className="px-4 py-4">
              <div className="space-y-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                      <Link
                          key={item.name}
                          href={item.href}
                          className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 group relative overflow-hidden ${
                              active
                                  ? "bg-[hsl(var(--tech-accent-muted))] text-[hsl(var(--tech-text-primary))] border border-[hsl(var(--tech-accent))]"
                                  : "text-[hsl(var(--tech-text-secondary))] hover:text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-bg-tertiary))] hover:border-[hsl(var(--tech-border-hover))] border border-transparent"
                          } ${isCollapsed ? 'justify-center px-3 py-2.5' : 'gap-3 px-3 py-2.5'}`}
                      >
                        {/* Tooltip for collapsed state */}
                        {isCollapsed && (
                            <div className="absolute left-full ml-2 px-2 py-1 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded text-xs text-[hsl(var(--tech-text-primary))] opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap">
                              {item.name}
                            </div>
                        )}
                        {active && (
                            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--tech-accent))] to-transparent opacity-10"></div>
                        )}
                        <Icon className={`h-5 w-5 flex-shrink-0 relative z-10 transition-colors ${
                            active ? "text-[hsl(var(--tech-accent))]" : "group-hover:text-[hsl(var(--tech-accent))]"
                        }`} />
                        <div
                            className={`flex flex-col min-w-0 relative z-10 transition-all duration-300 overflow-hidden ${
                                isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                            }`}
                        >
                          <span className="truncate whitespace-nowrap">{item.name}</span>
                          <span className={`text-xs truncate whitespace-nowrap transition-colors ${
                              active ? "text-[hsl(var(--tech-text-secondary))]" : "text-[hsl(var(--tech-text-muted))] group-hover:text-[hsl(var(--tech-text-secondary))]"
                          }`}>
                        {item.description}
                      </span>
                        </div>
                      </Link>
                  );
                })}
              </div>
            </nav>
          </div>

          {/* Bottom Navigation */}
          <div className="px-4 py-4 border-t border-[hsl(var(--tech-border))] flex-shrink-0">
            <div className="space-y-2 mb-4">
              {bottomItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);

                return (
                    <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 group relative overflow-hidden ${
                            active
                                ? "bg-[hsl(var(--tech-accent-muted))] text-[hsl(var(--tech-text-primary))] border border-[hsl(var(--tech-accent))]"
                                : "text-[hsl(var(--tech-text-muted))] hover:text-[hsl(var(--tech-text-primary))] hover:bg-[hsl(var(--tech-bg-tertiary))] border border-transparent hover:border-[hsl(var(--tech-border-hover))]"
                        } ${isCollapsed ? 'justify-center px-3 py-2' : 'gap-3 px-3 py-2'}`}
                    >
                      {/* Tooltip for collapsed state */}
                      {isCollapsed && (
                          <div className="absolute left-full ml-2 px-2 py-1 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded text-xs text-[hsl(var(--tech-text-primary))] opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap">
                            {item.name}
                          </div>
                      )}
                      <Icon
                          className={`h-5 w-5 flex-shrink-0 relative z-10 transition-colors ${
                              active ? "text-[hsl(var(--tech-accent))]" : "group-hover:text-[hsl(var(--tech-accent))]"
                          }`}
                      />
                      <span
                          className={`truncate relative z-10 whitespace-nowrap transition-all duration-300 overflow-hidden ${
                              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                          }`}
                      >
                    {item.name}
                  </span>
                    </Link>
                );
              })}
            </div>
          </div>

          {/* Usage Indicator */}
          {subscription && !isCollapsed && (
            <div className="px-4 py-3 border-t border-[hsl(var(--tech-border))] flex-shrink-0">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[hsl(var(--tech-text-secondary))] font-medium">
                    Usage
                  </span>
                  <span className="text-[hsl(var(--tech-text-muted))]">
                    {subscription.plan_type}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-[hsl(var(--tech-bg-tertiary))] rounded-full overflow-hidden border border-[hsl(var(--tech-border))]">
                  <div
                    className="h-full bg-gradient-to-r from-[hsl(var(--tech-accent))] to-[hsl(var(--tech-accent-bright))] transition-all duration-300"
                    style={{
                      width: `${subscription.minutes_included > 0 ? Math.min(100, (subscription.minutes_used / subscription.minutes_included) * 100) : 0}%`
                    }}
                  />
                </div>

                {/* Usage Details */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[hsl(var(--tech-text-muted))]">
                    {subscription.minutes_remaining.toFixed(2)} min left
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* User Info - At the very bottom */}
          <div className="px-4 py-4 border-t border-[hsl(var(--tech-border))] flex-shrink-0">
            <Link
                href="/dashboard/account"
                className={`flex items-center text-sm rounded-lg bg-[hsl(var(--tech-bg-tertiary))] border border-[hsl(var(--tech-border))] hover:bg-[hsl(var(--tech-accent-muted))] hover:border-[hsl(var(--tech-accent))] transition-all duration-200 group relative ${isCollapsed ? 'justify-center px-3 py-2' : 'gap-3 px-3 py-2'}`}
            >
              {/* Tooltip for collapsed state */}
              {isCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded text-xs text-[hsl(var(--tech-text-primary))] opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap">
                    {userData?.fullName || 'User'}
                  </div>
              )}
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-[hsl(var(--tech-text-primary))]"/>
              </div>
              <div className={`flex-1 min-w-0 transition-all duration-300 overflow-hidden ${
                  isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
              }`}>
                <div className="text-[hsl(var(--tech-text-primary))] font-medium truncate group-hover:text-[hsl(var(--tech-accent))] transition-colors whitespace-nowrap">
                  {userData?.fullName || 'User'}
                </div>
                <div className="text-[hsl(var(--tech-text-muted))] text-xs truncate whitespace-nowrap">
                  {userData?.email || 'user@example.com'}
                </div>
              </div>
            </Link>
          </div>
        </div>
      </>
  );
}