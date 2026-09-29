import { describe, it, expect } from 'vitest';

/**
 * RLS Evaluation Engine
 * Simulates PostgreSQL Row-Level Security evaluation with exact SQL policy semantics from supabase/migrations (see 20260928000000_tenant_isolation_fixes.sql)
 */
interface SecurityContext {
  uid: string | null;
  // Top-level JWT role: Supabase only ever issues anon / authenticated / service_role here
  role: 'anon' | 'authenticated' | 'service_role';
  // Server-controlled app_metadata.role (20261001000100_admin_role_policies.sql: public.is_admin())
  appRole?: 'admin' | 'operator';
}

const bypasses = (ctx: SecurityContext) => ctx.role === 'service_role' || ctx.appRole === 'admin';

interface FacultyProfileRow {
  id: string;
  user_id: string | null;
  full_name: string;
}

interface ProfileTermsRow {
  id: string;
  profile_id: string;
  term: string;
}

interface OpportunityStatusRow {
  opportunity_id: string;
  faculty_id: string;
  status: string;
}

interface FeedbackRow {
  id: string;
  faculty_id: string;
  rating: string;
}

interface UserPreferencesRow {
  user_id: string;
  theme: string;
  min_score: number;
}

interface UserOpportunityStateRow {
  id: string;
  user_id: string;
  opportunity_id: string;
  saved: boolean;
  notes: string;
}

interface UserActivityRow {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
}

interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  user_id: string;
  role: string;
  content: string;
}

interface OpportunityRow {
  id: string;
  title: string;
}

describe('PostgreSQL RLS Multi-Tenant Security & Isolation Regression Tests', () => {
  const USER_A_ID = '00000000-0000-0000-0000-000000000001';
  const USER_B_ID = '00000000-0000-0000-0000-000000000002';

  const ctxUserA: SecurityContext = { uid: USER_A_ID, role: 'authenticated' };
  const ctxUserB: SecurityContext = { uid: USER_B_ID, role: 'authenticated' };
  const ctxAnon: SecurityContext = { uid: null, role: 'anon' };
  const ctxServiceRole: SecurityContext = { uid: null, role: 'service_role' };

  // Setup sample data across all 9 RLS-guarded tables
  const facultyProfiles: FacultyProfileRow[] = [
    { id: 'prof-a', user_id: USER_A_ID, full_name: 'Dr. Meera Patel' },
    { id: 'prof-b', user_id: USER_B_ID, full_name: 'Dr. Rajesh Kumar' },
    { id: 'prof-legacy', user_id: null, full_name: 'Unassigned Seed Profile' }
  ];

  const profileTerms: ProfileTermsRow[] = [
    { id: 'pt-a1', profile_id: 'prof-a', term: 'Neuromorphic Computing' },
    { id: 'pt-a2', profile_id: 'prof-a', term: 'Edge AI' },
    { id: 'pt-b1', profile_id: 'prof-b', term: 'Photovoltaic Materials' }
  ];

  const opportunityStatus: OpportunityStatusRow[] = [
    { opportunity_id: 'opp-1', faculty_id: 'prof-a', status: 'pursuing' },
    { opportunity_id: 'opp-1', faculty_id: 'prof-b', status: 'dismissed' }
  ];

  const feedback: FeedbackRow[] = [
    { id: 'fb-a', faculty_id: 'prof-a', rating: 'relevant' },
    { id: 'fb-b', faculty_id: 'prof-b', rating: 'not_relevant' }
  ];

  const userPreferences: UserPreferencesRow[] = [
    { user_id: USER_A_ID, theme: 'dark', min_score: 75 },
    { user_id: USER_B_ID, theme: 'light', min_score: 50 }
  ];

  const userOpportunityState: UserOpportunityStateRow[] = [
    { id: 'state-a', user_id: USER_A_ID, opportunity_id: 'opp-1', saved: true, notes: 'Target for DST call' },
    { id: 'state-b', user_id: USER_B_ID, opportunity_id: 'opp-2', saved: true, notes: 'Target for ICMR call' }
  ];

  const userActivity: UserActivityRow[] = [
    { id: 'act-a1', user_id: USER_A_ID, event_type: 'saved_opportunity', title: 'Saved DST Grant' },
    { id: 'act-b1', user_id: USER_B_ID, event_type: 'saved_opportunity', title: 'Saved ICMR Call' }
  ];

  const chatSessions: ChatSessionRow[] = [
    { id: 'sess-a', user_id: USER_A_ID, title: 'Neuromorphic Research Consultation' },
    { id: 'sess-b', user_id: USER_B_ID, title: 'Solar Cell Efficiency Literature' }
  ];

  const chatMessages: ChatMessageRow[] = [
    { id: 'msg-a', session_id: 'sess-a', user_id: USER_A_ID, role: 'user', content: 'Find funding for neuromorphic chips' },
    { id: 'msg-b', session_id: 'sess-b', user_id: USER_B_ID, role: 'user', content: 'Find conferences in material science' }
  ];

  const opportunities: OpportunityRow[] = [
    { id: 'opp-1', title: 'DST-SERB Core Research Grant in Computing' },
    { id: 'opp-2', title: 'ICMR Advanced Biomedical Engineering Fellowship' }
  ];

  // Helper evaluators applying the exact policies in supabase/migrations (see 20260928000000_tenant_isolation_fixes.sql)
  const rlsFacultyProfile = (ctx: SecurityContext, rows: FacultyProfileRow[]) => {
    if (ctx.role === 'anon') return [];
    if (bypasses(ctx)) return rows;
    // Policy: user_id = auth.uid()  (the unassigned seed profile is no longer readable by everyone)
    return rows.filter((r) => r.user_id === ctx.uid);
  };

  const rlsProfileTerms = (ctx: SecurityContext, rows: ProfileTermsRow[]) => {
    if (ctx.role === 'anon') return [];
    if (bypasses(ctx)) return rows;
    // Policy: profile_id in (select id from faculty_profile where user_id = auth.uid())
    const allowedProfIds = new Set(
      facultyProfiles.filter((p) => p.user_id === ctx.uid).map((p) => p.id)
    );
    return rows.filter((r) => allowedProfIds.has(r.profile_id));
  };

  const rlsOpportunityStatus = (ctx: SecurityContext, rows: OpportunityStatusRow[]) => {
    if (ctx.role === 'anon') return [];
    if (bypasses(ctx)) return rows;
    // Policy: faculty_id in (select id from faculty_profile where user_id = auth.uid())
    const allowedProfIds = new Set(
      facultyProfiles.filter((p) => p.user_id === ctx.uid).map((p) => p.id)
    );
    return rows.filter((r) => allowedProfIds.has(r.faculty_id));
  };

  const rlsFeedback = (ctx: SecurityContext, rows: FeedbackRow[]) => {
    if (ctx.role === 'anon') return [];
    if (bypasses(ctx)) return rows;
    const allowedProfIds = new Set(
      facultyProfiles.filter((p) => p.user_id === ctx.uid).map((p) => p.id)
    );
    return rows.filter((r) => allowedProfIds.has(r.faculty_id));
  };

  // private: chat_sessions, chat_messages, user_activity have no admin branch
  const rlsDirectUserTable = <T extends { user_id: string }>(ctx: SecurityContext, rows: T[], opts: { private?: boolean } = {}) => {
    if (ctx.role === 'anon') return [];
    if (ctx.role === 'service_role' || (!opts.private && ctx.appRole === 'admin')) return rows;
    return rows.filter((r) => r.user_id === ctx.uid);
  };

  it('app_metadata admin reads profiles and tracking state but not private chats or activity', () => {
    const ctxAdmin: SecurityContext = { uid: '00000000-0000-0000-0000-00000000000a', role: 'authenticated', appRole: 'admin' };
    expect(rlsFacultyProfile(ctxAdmin, facultyProfiles)).toHaveLength(facultyProfiles.length);
    expect(rlsDirectUserTable(ctxAdmin, userOpportunityState)).toHaveLength(userOpportunityState.length);
    expect(rlsDirectUserTable(ctxAdmin, chatSessions, { private: true })).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAdmin, chatMessages, { private: true })).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAdmin, userActivity, { private: true })).toHaveLength(0);
    // An operator is not an admin
    const ctxOperator: SecurityContext = { uid: '00000000-0000-0000-0000-00000000000b', role: 'authenticated', appRole: 'operator' };
    expect(rlsFacultyProfile(ctxOperator, facultyProfiles)).toHaveLength(0);
  });

  it('Table 1: faculty_profile isolates User A and User B completely', () => {
    const resA = rlsFacultyProfile(ctxUserA, facultyProfiles);
    const resB = rlsFacultyProfile(ctxUserB, facultyProfiles);

    expect(resA.some((r) => r.user_id === USER_A_ID)).toBe(true);
    expect(resA.some((r) => r.user_id === USER_B_ID)).toBe(false); // 0 rows of User B
    expect(resB.some((r) => r.user_id === USER_B_ID)).toBe(true);
    expect(resB.some((r) => r.user_id === USER_A_ID)).toBe(false); // 0 rows of User A
    expect(resA.some((r) => r.user_id === null)).toBe(false); // unassigned seed profile not shared
  });

  it('Table 2: profile_terms cascades isolation through faculty_profile ownership', () => {
    const resA = rlsProfileTerms(ctxUserA, profileTerms);
    const resB = rlsProfileTerms(ctxUserB, profileTerms);

    expect(resA.map((t) => t.term)).toContain('Neuromorphic Computing');
    expect(resA.map((t) => t.term)).not.toContain('Photovoltaic Materials');
    expect(resB.map((t) => t.term)).toContain('Photovoltaic Materials');
    expect(resB.map((t) => t.term)).not.toContain('Neuromorphic Computing');
  });

  it('Table 3: opportunity_status strictly prevents cross-tenant tracking visibility', () => {
    const resA = rlsOpportunityStatus(ctxUserA, opportunityStatus);
    const resB = rlsOpportunityStatus(ctxUserB, opportunityStatus);

    expect(resA.length).toBe(1);
    expect(resA[0].status).toBe('pursuing');
    expect(resB.length).toBe(1);
    expect(resB[0].status).toBe('dismissed');
  });

  it('Table 4: feedback table restricts submissions and reads to owner', () => {
    const resA = rlsFeedback(ctxUserA, feedback);
    const resB = rlsFeedback(ctxUserB, feedback);

    expect(resA.length).toBe(1);
    expect(resA[0].rating).toBe('relevant');
    expect(resB.length).toBe(1);
    expect(resB[0].rating).toBe('not_relevant');
  });

  it('Table 5: user_preferences isolates dashboard and alert settings', () => {
    const resA = rlsDirectUserTable(ctxUserA, userPreferences);
    const resB = rlsDirectUserTable(ctxUserB, userPreferences);

    expect(resA[0].theme).toBe('dark');
    expect(resA[0].min_score).toBe(75);
    expect(resB[0].theme).toBe('light');
    expect(resB[0].min_score).toBe(50);
  });

  it('Table 6: user_opportunity_state isolates bookmarks and personal notes', () => {
    const resA = rlsDirectUserTable(ctxUserA, userOpportunityState);
    const resB = rlsDirectUserTable(ctxUserB, userOpportunityState);

    expect(resA.length).toBe(1);
    expect(resA[0].notes).toBe('Target for DST call');
    expect(resB.length).toBe(1);
    expect(resB[0].notes).toBe('Target for ICMR call');
  });

  it('Table 7: user_activity isolates audit trails and action history', () => {
    const resA = rlsDirectUserTable(ctxUserA, userActivity);
    const resB = rlsDirectUserTable(ctxUserB, userActivity);

    expect(resA[0].title).toBe('Saved DST Grant');
    expect(resB[0].title).toBe('Saved ICMR Call');
  });

  it('Table 8 & 9: chat_sessions and chat_messages isolate private Copilot conversations', () => {
    const sessA = rlsDirectUserTable(ctxUserA, chatSessions);
    const sessB = rlsDirectUserTable(ctxUserB, chatSessions);
    expect(sessA[0].title).toContain('Neuromorphic');
    expect(sessB[0].title).toContain('Solar Cell');

    const msgA = rlsDirectUserTable(ctxUserA, chatMessages);
    const msgB = rlsDirectUserTable(ctxUserB, chatMessages);
    expect(msgA[0].content).toContain('neuromorphic');
    expect(msgB[0].content).toContain('material science');
  });

  it('Anonymous callers are rejected by default across all private tenant tables', () => {
    expect(rlsFacultyProfile(ctxAnon, facultyProfiles)).toHaveLength(0);
    expect(rlsProfileTerms(ctxAnon, profileTerms)).toHaveLength(0);
    expect(rlsOpportunityStatus(ctxAnon, opportunityStatus)).toHaveLength(0);
    expect(rlsFeedback(ctxAnon, feedback)).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAnon, userPreferences)).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAnon, userOpportunityState)).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAnon, userActivity)).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAnon, chatSessions)).toHaveLength(0);
    expect(rlsDirectUserTable(ctxAnon, chatMessages)).toHaveLength(0);
  });

  it('Service role and background workers bypass RLS for high-throughput ingestion', () => {
    expect(rlsFacultyProfile(ctxServiceRole, facultyProfiles)).toHaveLength(facultyProfiles.length);
    expect(rlsDirectUserTable(ctxServiceRole, userPreferences)).toHaveLength(userPreferences.length);
    expect(rlsDirectUserTable(ctxServiceRole, userOpportunityState)).toHaveLength(userOpportunityState.length);
  });

  it('Shared catalog tables (opportunities) remain universally readable by authenticated tenants', () => {
    // Opportunities policy: using (true) for authenticated
    const authenticatedRead = (ctx: SecurityContext, rows: OpportunityRow[]) => {
      return ctx.role === 'anon' ? [] : rows;
    };

    const oppsA = authenticatedRead(ctxUserA, opportunities);
    const oppsB = authenticatedRead(ctxUserB, opportunities);

    expect(oppsA).toHaveLength(2);
    expect(oppsB).toHaveLength(2);
  });
});
