"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { Toaster, toast } from 'react-hot-toast';
import { Search, Clock, Plus, Minus, User } from 'lucide-react';

interface Subscription {
  id: string;
  plan_type: string;
  status: string;
  hours_included: number;
  hours_used: number;
  hours_remaining: number;
  overage_hours: number;
  current_period_start: string;
  current_period_end: string;
  user_profiles: {
    id: string;
    email: string;
    full_name: string;
  };
}

export default function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  useEffect(() => {
    checkAdminAuth();
    fetchSubscriptions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const checkAdminAuth = async () => {
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      window.location.href = '/auth/login';
      return;
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      window.location.href = '/dashboard';
      return;
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const response = await fetch(
        `/api/admin/subscriptions?page=${page}&search=${encodeURIComponent(search)}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch subscriptions');
      
      const data = await response.json();
      setSubscriptions(data.subscriptions);
      setTotalPages(data.pagination.totalPages);
    } catch (error) {
      toast.error('Failed to load subscriptions');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const adjustHours = async (subscriptionId: string, adjustment: number) => {
    const reason = prompt(`Adjust hours by ${adjustment > 0 ? '+' : ''}${adjustment}. Please provide a reason:`);
    if (!reason) return;

    setAdjustingId(subscriptionId);
    try {
      const response = await fetch('/api/admin/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId,
          hoursAdjustment: adjustment,
          reason,
        }),
      });

      if (!response.ok) throw new Error('Failed to adjust hours');

      toast.success(`Hours adjusted by ${adjustment > 0 ? '+' : ''}${adjustment}`);
      fetchSubscriptions();
    } catch (error) {
      toast.error('Failed to adjust hours');
      console.error(error);
    } finally {
      setAdjustingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-500';
      case 'canceled': return 'text-red-500';
      case 'past_due': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  if (loading) {
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
      
      <DashboardSidebar className="flex-shrink-0" />
      
      <main className="flex-1 overflow-hidden bg-[hsl(var(--tech-bg))]">
        <div className="h-full overflow-y-auto">
          <div className="p-8">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col gap-6">
                {/* Header */}
                <div>
                  <h1 className="text-3xl font-bold text-[hsl(var(--tech-text-primary))] mb-2">
                    Subscription Management
                  </h1>
                  <p className="text-[hsl(var(--tech-text-secondary))]">
                    Manage customer subscriptions and adjust usage hours
                  </p>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[hsl(var(--tech-text-muted))]" />
                  <input
                    type="text"
                    placeholder="Search by email or name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-lg text-[hsl(var(--tech-text-primary))] placeholder-[hsl(var(--tech-text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--tech-accent))]"
                  />
                </div>

                {/* Subscriptions Table */}
                <div className="bg-[hsl(var(--tech-bg-secondary))] border border-[hsl(var(--tech-border))] rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[hsl(var(--tech-bg-tertiary))]">
                        <tr>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Customer</th>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Plan</th>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Status</th>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Hours</th>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Period</th>
                          <th className="text-left p-4 text-[hsl(var(--tech-text-primary))] font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subscriptions.map((subscription) => (
                          <tr key={subscription.id} className="border-t border-[hsl(var(--tech-border))]">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-[hsl(var(--tech-accent))] rounded-full flex items-center justify-center">
                                  <User className="h-4 w-4 text-white" />
                                </div>
                                <div>
                                  <div className="text-[hsl(var(--tech-text-primary))] font-medium">
                                    {subscription.user_profiles.full_name || 'Unknown'}
                                  </div>
                                  <div className="text-[hsl(var(--tech-text-secondary))] text-sm">
                                    {subscription.user_profiles.email}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <span className="px-2 py-1 bg-[hsl(var(--tech-bg-tertiary))] text-[hsl(var(--tech-text-primary))] rounded text-sm">
                                {subscription.plan_type}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`font-medium ${getStatusColor(subscription.status)}`}>
                                {subscription.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="space-y-1">
                                <div className="text-[hsl(var(--tech-text-primary))] text-sm">
                                  {subscription.hours_used.toFixed(1)} / {subscription.hours_included} hours used
                                </div>
                                <div className="text-[hsl(var(--tech-text-secondary))] text-xs">
                                  {subscription.hours_remaining.toFixed(1)} remaining
                                  {subscription.overage_hours > 0 && (
                                    <span className="text-[hsl(var(--tech-warning))] ml-2">
                                      (+{subscription.overage_hours.toFixed(1)} overage)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="text-[hsl(var(--tech-text-secondary))] text-sm">
                                {formatDate(subscription.current_period_start)} - {formatDate(subscription.current_period_end)}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => adjustHours(subscription.id, 10)}
                                  disabled={adjustingId === subscription.id}
                                  className="p-2 bg-green-500 hover:bg-green-600 text-white rounded transition-colors disabled:opacity-50"
                                  title="Add 10 hours"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => adjustHours(subscription.id, -10)}
                                  disabled={adjustingId === subscription.id}
                                  className="p-2 bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
                                  title="Remove 10 hours"
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    const customAdjustment = prompt('Enter hours to adjust (positive or negative):');
                                    if (customAdjustment) {
                                      const hours = parseFloat(customAdjustment);
                                      if (!isNaN(hours)) {
                                        adjustHours(subscription.id, hours);
                                      }
                                    }
                                  }}
                                  disabled={adjustingId === subscription.id}
                                  className="p-2 bg-[hsl(var(--tech-accent))] hover:bg-[hsl(var(--tech-accent-hover))] text-white rounded transition-colors disabled:opacity-50"
                                  title="Custom adjustment"
                                >
                                  <Clock className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="p-4 border-t border-[hsl(var(--tech-border))] flex justify-center gap-2">
                      <button
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="px-4 py-2 bg-[hsl(var(--tech-bg-tertiary))] text-[hsl(var(--tech-text-primary))] rounded disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="px-4 py-2 text-[hsl(var(--tech-text-secondary))]">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-[hsl(var(--tech-bg-tertiary))] text-[hsl(var(--tech-text-primary))] rounded disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}