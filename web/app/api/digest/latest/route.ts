import { NextRequest } from 'next/server';
import { getSupabaseUserClient, getSupabaseAdminClient } from '@/lib/supabaseServerClient';
import { authenticateRequest } from '@/lib/auth';
import { createErrorResponse, createSuccessResponse } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
      return auth.errorResponse!;
    }

    const supabase = auth.user?.isServiceRole
      ? getSupabaseAdminClient()
      : getSupabaseUserClient(auth.user?.token);

    const { data: runs, error } = await supabase
      .from('run_log')
      .select('*')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) {
      return createErrorResponse('DATABASE_ERROR', error.message, 500, req);
    }

    const latest = runs?.[0];

    const markdown = `# Weekly Opportunity Digest
Generated: ${latest?.finished_at ? new Date(latest.finished_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}

- Opportunities found: ${latest?.opportunities_found || 0}
- Opportunities new: ${latest?.opportunities_new || 0}

Refer to dashboard for interactive component scoring details and direct citations.
`;

    return createSuccessResponse(
      {
        generated_at: latest?.finished_at || new Date().toISOString(),
        markdown
      },
      req
    );
  } catch (err: any) {
    return createErrorResponse('INTERNAL_SERVER_ERROR', err.message, 500, req);
  }
}
