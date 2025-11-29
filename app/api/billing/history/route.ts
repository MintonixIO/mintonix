import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const { data: billingHistory, error } = await supabase
      .from('billing_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json(billingHistory || []);
  } catch (error) {
    console.error('Error fetching billing history:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}