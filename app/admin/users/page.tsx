"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ArrowLeft, 
  Users, 
  Shield, 
  ShieldCheck,
  User,
  Calendar,
  Edit,
  Clock
} from "lucide-react";
import Link from "next/link";
import { UserProfile } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

interface Subscription {
  id: string;
  plan_type: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';
  status: 'active' | 'canceled' | 'past_due' | 'incomplete';
  hours_included: number;
  hours_used: number;
  hours_remaining: number;
  overage_hours: number;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

interface UserWithSubscription extends UserProfile {
  subscriptions: Subscription[];
}

export default function AdminUsersPage() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserWithSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserWithSubscription | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const router = useRouter();

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (response.ok) {
        const userData = await response.json();
        setUsers(userData);
      }
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    }
  };

  useEffect(() => {
    const checkSuperAdminAccess = async () => {
      const supabase = createClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        router.push("/auth/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError || !profile || profile.role !== 'super_admin') {
        router.push("/admin");
        return;
      }

      setUserProfile(profile);
      await loadUsers();
      setIsLoading(false);
    };

    checkSuperAdminAccess();
  }, [router]);

  const updateUserRole = async (userId: string, newRole: 'user' | 'admin' | 'super_admin') => {
    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;

    setUpdatingUserId(userId);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          role: newRole,
        }),
      });

      if (response.ok) {
        setUsers(users.map(user => 
          user.id === userId ? { ...user, role: newRole } : user
        ));
        toast.success(`User role updated to ${newRole}`);
      } else {
        const error = await response.json();
        toast.error(`Failed to update user role: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating user role:', error);
      toast.error('Failed to update user role');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const updateUserSubscription = async (userId: string, subscriptionData: Partial<Subscription>) => {
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          subscriptionData,
        }),
      });

      if (response.ok) {
        await loadUsers();
        toast.success('Subscription updated successfully');
        setEditDialogOpen(false);
        setEditingUser(null);
      } else {
        const error = await response.json();
        toast.error(`Failed to update subscription: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating subscription:', error);
      toast.error('Failed to update subscription');
    }
  };

  const openEditDialog = (user: UserWithSubscription) => {
    setEditingUser(user);
    setEditDialogOpen(true);
  };


  const getUserSubscription = (user: UserWithSubscription): Subscription | null => {
    return user.subscriptions && user.subscriptions.length > 0 ? user.subscriptions[0] : null;
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'super_admin':
        return <ShieldCheck className="h-4 w-4" />;
      case 'admin':
        return <Shield className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'default' as const;
      case 'admin':
        return 'secondary' as const;
      default:
        return 'outline' as const;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading users...</div>
      </div>
    );
  }

  if (!userProfile || userProfile.role !== 'super_admin') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Access Denied</h1>
          <p className="text-muted-foreground">Super admin access required.</p>
          <Button asChild className="mt-4">
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Admin
                </Link>
              </Button>
              <h1 className="text-xl font-bold text-foreground">User Management</h1>
              <Badge variant="default">SUPER ADMIN</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-card border border-border rounded-lg">
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-semibold text-foreground">All Users</h2>
                <p className="text-muted-foreground text-sm">Manage user roles and permissions</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {users.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No users found</h3>
                <p className="text-muted-foreground">Users will appear here as they sign up.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-foreground">User</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Role</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Subscription</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Usage</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Joined</th>
                      <th className="text-left py-3 px-4 font-medium text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const subscription = getUserSubscription(user);
                      return (
                        <tr key={user.id} className="border-b border-border/50">
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium text-foreground">
                                {user.full_name || 'No name'}
                              </p>
                              <p className="text-sm text-muted-foreground">{user.email}</p>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={getRoleBadgeVariant(user.role)} className="flex items-center gap-1 w-fit">
                              {getRoleIcon(user.role)}
                              {user.role.replace('_', ' ').toUpperCase()}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {subscription ? (
                              <div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className="text-xs">
                                    {subscription.plan_type}
                                  </Badge>
                                  <Badge 
                                    variant={subscription.status === 'active' ? 'default' : 'destructive'} 
                                    className="text-xs"
                                  >
                                    {subscription.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {subscription.hours_included}h included
                                </p>
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-xs">No subscription</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {subscription ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm">
                                  <Clock className="h-3 w-3" />
                                  <span className={subscription.hours_remaining < 1 ? 'text-red-600' : 'text-foreground'}>
                                    {subscription.hours_remaining.toFixed(1)}h left
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {subscription.hours_used.toFixed(1)} / {subscription.hours_included}h used
                                </div>
                                {subscription.overage_hours > 0 && (
                                  <div className="text-xs text-orange-600">
                                    +{subscription.overage_hours.toFixed(1)}h overage
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1 text-muted-foreground text-sm">
                              <Calendar className="h-4 w-4" />
                              {new Date(user.created_at).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(user)}
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              {user.role !== 'super_admin' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => updateUserRole(user.id, user.role === 'admin' ? 'user' : 'admin')}
                                  disabled={updatingUserId === user.id}
                                >
                                  {updatingUserId === user.id ? 'Updating...' : 
                                   user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                                </Button>
                              )}
                              {user.role === 'user' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => updateUserRole(user.id, 'super_admin')}
                                  disabled={updatingUserId === user.id}
                                >
                                  Make Super Admin
                                </Button>
                              )}
                              {user.id === userProfile.id && (
                                <Badge variant="outline" className="text-xs">
                                  You
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Role Explanation */}
        <div className="mt-8 bg-muted rounded-lg p-6">
          <h3 className="font-semibold text-foreground mb-4">Role Permissions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium text-foreground">User</p>
                <p className="text-muted-foreground">Standard access to the platform</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Admin</p>
                <p className="text-muted-foreground">Can manage blog posts and content</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Super Admin</p>
                <p className="text-muted-foreground">Full access including user management</p>
              </div>
            </div>
          </div>
        </div>

        {/* Edit User Modal */}
        {editDialogOpen && editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-lg max-w-2xl w-full m-4 max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                    <Edit className="h-5 w-5" />
                    Edit User: {editingUser.full_name || editingUser.email}
                  </h2>
                  <button 
                    onClick={() => setEditDialogOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              </div>
              
              <EditUserForm 
                user={editingUser} 
                onSave={updateUserSubscription}
                onCancel={() => setEditDialogOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface EditUserFormProps {
  user: UserWithSubscription;
  onSave: (userId: string, subscriptionData: Partial<Subscription>) => void;
  onCancel: () => void;
}

function EditUserForm({ user, onSave, onCancel }: EditUserFormProps) {
  const subscription = user.subscriptions?.[0];
  
  const [formData, setFormData] = useState({
    plan_type: subscription?.plan_type || 'FREE',
    status: subscription?.status || 'active',
    hours_included: subscription?.hours_included || 5,
    hours_used: subscription?.hours_used || 0,
    hours_remaining: subscription?.hours_remaining || 5,
    overage_hours: subscription?.overage_hours || 0,
    current_period_start: subscription?.current_period_start ? 
      new Date(subscription.current_period_start).toISOString().split('T')[0] : 
      new Date().toISOString().split('T')[0],
    current_period_end: subscription?.current_period_end ? 
      new Date(subscription.current_period_end).toISOString().split('T')[0] : 
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  const handleSubmit = () => {
    const subscriptionData = {
      ...formData,
      current_period_start: new Date(formData.current_period_start).toISOString(),
      current_period_end: new Date(formData.current_period_end).toISOString()
    };
    onSave(user.id, subscriptionData);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="plan_type">Plan Type</Label>
          <select 
            id="plan_type"
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            value={formData.plan_type} 
            onChange={(e) => setFormData({ ...formData, plan_type: e.target.value as 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE' })}
          >
            <option value="FREE">Free</option>
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select 
            id="status"
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            value={formData.status} 
            onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'canceled' | 'past_due' | 'incomplete' })}
          >
            <option value="active">Active</option>
            <option value="canceled">Canceled</option>
            <option value="past_due">Past Due</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="hours_included">Hours Included</Label>
          <Input
            id="hours_included"
            type="number"
            step="0.1"
            value={formData.hours_included}
            onChange={(e) => setFormData({ ...formData, hours_included: parseFloat(e.target.value) || 0 })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="hours_used">Hours Used</Label>
          <Input
            id="hours_used"
            type="number"
            step="0.1"
            value={formData.hours_used}
            onChange={(e) => setFormData({ ...formData, hours_used: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="hours_remaining">Hours Remaining</Label>
          <Input
            id="hours_remaining"
            type="number"
            step="0.1"
            value={formData.hours_remaining}
            onChange={(e) => setFormData({ ...formData, hours_remaining: parseFloat(e.target.value) || 0 })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="overage_hours">Overage Hours</Label>
          <Input
            id="overage_hours"
            type="number"
            step="0.1"
            value={formData.overage_hours}
            onChange={(e) => setFormData({ ...formData, overage_hours: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="period_start">Billing Period Start</Label>
          <Input
            id="period_start"
            type="date"
            value={formData.current_period_start}
            onChange={(e) => setFormData({ ...formData, current_period_start: e.target.value })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="period_end">Billing Period End</Label>
          <Input
            id="period_end"
            type="date"
            value={formData.current_period_end}
            onChange={(e) => setFormData({ ...formData, current_period_end: e.target.value })}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-6 border-t border-border">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}