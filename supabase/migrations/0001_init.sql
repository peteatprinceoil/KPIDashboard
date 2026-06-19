-- Email ingestion audit/dedupe log
create table if not exists email_messages (
  message_id text primary key,
  subject text not null,
  received_at timestamptz not null,
  report_type text,
  status text not null default 'pending', -- pending | parsed | failed | unrecognized
  error text,
  created_at timestamptz not null default now()
);

-- Daily fuel sales, one row per store per fuel type per report date
create table if not exists fuel_sales_daily (
  id bigint generated always as identity primary key,
  report_date date not null,
  store_id text not null,
  store_name text not null,
  fuel_type text not null,
  gallons numeric,
  dollars numeric,
  comparison_gallons numeric,
  comparison_dollars numeric,
  ingested_message_id text not null references email_messages(message_id),
  created_at timestamptz not null default now(),
  unique (report_date, store_id, fuel_type)
);

create index if not exists fuel_sales_daily_report_date_idx on fuel_sales_daily (report_date);
create index if not exists fuel_sales_daily_store_id_idx on fuel_sales_daily (store_id);

-- Placeholder tables for KPIs without a data source yet.
-- Populated once Ben schedules the corresponding Taiga report emails and a parser is added.

create table if not exists margin_daily (
  id bigint generated always as identity primary key,
  report_date date not null,
  store_id text not null,
  store_name text not null,
  category text, -- null = overall store margin
  margin_pct numeric,
  ingested_message_id text not null references email_messages(message_id),
  created_at timestamptz not null default now(),
  unique (report_date, store_id, category)
);

create table if not exists top_products (
  id bigint generated always as identity primary key,
  report_date date not null,
  store_id text,
  store_name text,
  product_name text not null,
  units_sold numeric,
  rank_direction text not null check (rank_direction in ('top', 'bottom')),
  ingested_message_id text not null references email_messages(message_id),
  created_at timestamptz not null default now()
);

create table if not exists voids (
  id bigint generated always as identity primary key,
  report_date date not null,
  store_id text not null,
  store_name text not null,
  void_count numeric,
  no_sale_count numeric,
  ingested_message_id text not null references email_messages(message_id),
  created_at timestamptz not null default now(),
  unique (report_date, store_id)
);

create table if not exists combo_sales (
  id bigint generated always as identity primary key,
  report_date date not null,
  store_id text not null,
  store_name text not null,
  daypart text not null check (daypart in ('breakfast', 'lunch')),
  anchor_item text not null,
  paired_item text not null,
  paired_count numeric,
  ingested_message_id text not null references email_messages(message_id),
  created_at timestamptz not null default now()
);
