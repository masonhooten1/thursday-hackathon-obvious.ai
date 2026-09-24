-- SignalPlan schema — Supabase Postgres (also runs on stock Postgres 15+ for
-- local tests). Every content table carries workspace_id; RLS is keyed to
-- workspace membership via auth.uid() (the Supabase helper reading
-- request.jwt.claims). Application queries additionally filter by
-- workspace_id — RLS is the second layer, not the only one.

create schema if not exists auth;

-- Local/stock-Postgres emulation of Supabase's auth.uid(). On a real Supabase
-- project the function already exists and this block is a no-op.
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as $body$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid $body$
    $fn$;
  end if;
end
$do$;

-- Supabase-style roles when running outside Supabase. `authenticated` is the
-- RLS-subjected role for user JWT sessions; `service_role` bypasses RLS the
-- way Supabase's does.
-- Role creation must tolerate a concurrent creator: Vitest workers apply
-- this schema to separate scratch databases in parallel, but roles are
-- cluster-wide, so two check-then-create races can interleave. Depending
-- on timing Postgres raises either duplicate_object (42710) or the raw
-- catalog unique_violation (23505) from pg_authid_rolname_index — both
-- mean the role already exists, which is the outcome we want.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    begin
      create role authenticated nologin;
    exception
      when duplicate_object or unique_violation then null;
    end;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    begin
      create role service_role nologin bypassrls;
    exception
      when duplicate_object or unique_violation then null;
    end;
  end if;
end
$roles$;

-- Supabase grants its roles usage on schema auth by default; a stock
-- Postgres does not, so policy evaluation of auth.uid() would fail there.
-- Re-granting on Supabase is unnecessary and can lack privileges, hence the
-- narrow exception — a grant failure for any other reason still aborts.
do $grants$
begin
  grant usage on schema auth to authenticated, service_role;
  grant execute on all functions in schema auth to authenticated, service_role;
exception
  when insufficient_privilege then
    if not exists (select 1 from pg_namespace where nspname = 'auth'
                   and has_schema_privilege('authenticated', 'auth', 'USAGE')) then
      raise;
    end if;
end
$grants$;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Supabase auth.users.id. No FK on purpose: local Postgres has no auth schema
  -- tables, and the cross-user RLS test only needs the uuid.
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  offer jsonb not null,
  search_query text,
  limits jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'partial')),
  -- Run-creation idempotency (brief §Core endpoints): repeated clicks with the
  -- same key return the original run.
  idempotency_key text not null,
  companies_total int not null default 0,
  companies_ready int not null default 0,
  companies_failed int not null default 0,
  model_requests_used int not null default 0,
  failures jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, idempotency_key)
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  domain text not null,
  status text not null default 'queued'
    check (status in ('queued', 'collecting', 'analyzing', 'drafting', 'reviewing',
                      'ready', 'partial', 'blocked', 'failed', 'cancelled')),
  hubspot_evidence jsonb,
  score jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists page_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  role text not null check (role in ('home', 'product', 'pricing', 'demo_contact',
                                     'customer_proof', 'integration_use_case')),
  method text not null check (method in ('html', 'rendered_dom')),
  http_status int,
  captured_at timestamptz not null default now(),
  visible_text text,
  snapshot_ref text,
  links jsonb not null default '[]',
  forms jsonb not null default '[]',
  runtime_observations jsonb not null default '[]',
  error text,
  limitations jsonb not null default '[]'
);

create table if not exists technology_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  vendor text not null,
  signature text not null,
  page_url text,
  method text not null check (method in ('html', 'rendered_dom', 'network', 'first_party_text')),
  integration_status text not null
    check (integration_status in ('observed', 'probable', 'not_observed', 'scan_incomplete')),
  detected_at timestamptz not null default now(),
  locator text,
  excerpt text,
  conflicting_portal_ids jsonb not null default '[]'
);

create table if not exists evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  captured_at timestamptz not null,
  method text not null check (method in ('html', 'rendered_dom', 'network', 'first_party_text')),
  locator text,
  excerpt text not null,
  snapshot_ref text,
  limitations jsonb not null default '[]'
);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  category text not null check (category in ('positioning', 'acquisition', 'conversion',
                                             'nurture', 'handoff', 'measurement')),
  observation text not null,
  evidence_ids jsonb not null default '[]',
  hypothesis text not null,
  recommendation text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  validation_needed jsonb not null default '[]',
  owner_role text not null,
  effort text not null check (effort in ('small', 'medium', 'large')),
  metric text not null
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role text not null check (role in ('discovery', 'collector', 'detector', 'positioning',
                                     'funnel', 'outbound', 'planner', 'writer', 'reviewer')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')),
  attempt int not null default 1,
  verdict text check (verdict in ('supported', 'revise', 'unsupported', 'needs_access')),
  error text,
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists account_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'review', 'ready', 'exported')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('pdf', 'csv')),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  storage_key text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  provider text check (provider in ('openai', 'anthropic')),
  -- AES-256-GCM ciphertext (lib/data/encryption.ts). Workers decrypt through
  -- the service-role connection only; GET /api/settings never returns it.
  api_key_encrypted text,
  key_last_four text,
  updated_at timestamptz
);

create index if not exists runs_campaign_idx on runs (campaign_id);
create index if not exists companies_run_idx on companies (run_id);
create index if not exists companies_campaign_idx on companies (campaign_id);
create index if not exists page_captures_company_idx on page_captures (company_id);
create index if not exists technology_signals_company_idx on technology_signals (company_id);
create index if not exists evidence_company_idx on evidence (company_id);
create index if not exists findings_company_idx on findings (company_id);
create index if not exists agent_runs_company_idx on agent_runs (company_id);
create index if not exists account_plans_company_idx on account_plans (company_id);
create index if not exists exports_company_idx on exports (company_id);

-- Idempotency guarantees (acceptance check 5): a retry or resumed run never
-- duplicates companies, and a retried export request never creates a second
-- active export. The partial index matches the get-or-create upsert.
create unique index if not exists companies_campaign_domain_uq
  on companies (campaign_id, domain);
create unique index if not exists exports_company_kind_active_uq
  on exports (company_id, kind) where status <> 'failed';

create or replace function touch_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end
$fn$;

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'runs', 'companies', 'account_plans'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I
                    for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Membership check shared by every content-table policy.
create or replace function app_is_member(ws uuid) returns boolean
language sql stable as $fn$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  )
$fn$;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;

create policy workspaces_select on workspaces for select to authenticated
  using (
    exists (
      select 1 from workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
    )
  );

create policy workspace_members_select on workspace_members for select to authenticated
  using (user_id = auth.uid());

-- Content-table policies. Beyond workspace membership, child rows must share
-- workspace_id with their parent row — an authenticated session cannot join
-- its workspace to another workspace's campaign, run, or company.
do $$
declare t text;
  extra text;
  content_tables text[] := array['campaigns', 'runs', 'companies', 'page_captures',
    'technology_signals', 'evidence', 'findings', 'agent_runs', 'account_plans',
    'exports', 'workspace_settings'];
  parent_checks text[] := array[
    '',
    ' and exists (select 1 from campaigns pc where pc.id = runs.campaign_id and pc.workspace_id = runs.workspace_id)',
    ' and exists (select 1 from runs pr where pr.id = companies.run_id and pr.workspace_id = companies.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = page_captures.company_id and pc.workspace_id = page_captures.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = technology_signals.company_id and pc.workspace_id = technology_signals.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = evidence.company_id and pc.workspace_id = evidence.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = findings.company_id and pc.workspace_id = findings.workspace_id)',
    ' and exists (select 1 from runs pr where pr.id = agent_runs.run_id and pr.workspace_id = agent_runs.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = account_plans.company_id and pc.workspace_id = account_plans.workspace_id)',
    ' and exists (select 1 from companies pc where pc.id = exports.company_id and pc.workspace_id = exports.workspace_id)',
    ''
  ];
begin
  for i in 1 .. array_length(content_tables, 1) loop
    t := content_tables[i];
    extra := parent_checks[i];
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %I_select on %I for select to authenticated
      using (app_is_member(workspace_id))
    $p$, t, t);
    execute format($p$
      create policy %I_insert on %I for insert to authenticated
      with check (app_is_member(workspace_id)%s)
    $p$, t, t, extra);
    execute format($p$
      create policy %I_update on %I for update to authenticated
      using (app_is_member(workspace_id))
      with check (app_is_member(workspace_id)%s)
    $p$, t, t, extra);
    execute format($p$
      create policy %I_delete on %I for delete to authenticated
      using (app_is_member(workspace_id))
    $p$, t, t);
  end loop;
end
$$;

-- Supabase pre-grants these roles; stock Postgres needs explicit grants.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
