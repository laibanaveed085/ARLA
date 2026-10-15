create table if not exists public.orders (
  id uuid primary key,
  order_number text not null unique,
  customer_name text not null,
  phone text not null,
  email text,
  fulfillment text not null check (fulfillment in ('pickup', 'delivery')),
  address jsonb,
  instructions text,
  requested_time text,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  subtotal_cents integer not null check (subtotal_cents > 0),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  tax_cents integer not null check (tax_cents >= 0),
  total_cents integer not null check (total_cents = subtotal_cents + delivery_fee_cents + tax_cents),
  status text not null default 'Received'
    check (status in ('Received', 'Preparing', 'Ready', 'Out for Delivery', 'Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_address_matches_fulfillment
    check ((fulfillment = 'pickup' and address is null) or (fulfillment = 'delivery' and address is not null))
);

create index if not exists orders_created_at_desc_idx on public.orders (created_at desc);
create index if not exists orders_status_created_at_idx on public.orders (status, created_at desc);

alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant all on table public.orders to service_role;
