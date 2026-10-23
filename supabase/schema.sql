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
  payment_status text not null default 'manual'
    check (payment_status in ('manual', 'pending', 'paid', 'failed', 'canceled')),
  checkout_request_id uuid unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  status text not null default 'Received'
    check (status in ('Received', 'Preparing', 'Ready', 'Out for Delivery', 'Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_address_matches_fulfillment
    check ((fulfillment = 'pickup' and address is null) or (fulfillment = 'delivery' and address is not null))
);

create index if not exists orders_created_at_desc_idx on public.orders (created_at desc);
create index if not exists orders_status_created_at_idx on public.orders (status, created_at desc);
create index if not exists orders_payment_status_created_at_idx on public.orders (payment_status, created_at desc);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

create or replace function public.process_stripe_payment_event(
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_order_id uuid,
  p_payment_intent_id text,
  p_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_order public.orders%rowtype;
  inserted_event text;
begin
  if p_payment_status not in ('paid', 'failed', 'canceled') then
    raise exception 'Invalid Stripe payment state.';
  end if;

  select *
    into target_order
    from public.orders
   where (
     p_session_id is not null
     and stripe_checkout_session_id = p_session_id
     and (p_order_id is null or id = p_order_id)
   ) or (
     p_session_id is null
     and p_order_id is not null
     and id = p_order_id
     and stripe_checkout_session_id is not null
   )
   for update;

  if not found then
    raise exception 'Stripe event did not match a saved order.';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing
  returning event_id into inserted_event;

  if inserted_event is null then
    return jsonb_build_object('duplicate', true, 'payment_status', target_order.payment_status);
  end if;

  if target_order.payment_status in ('pending', 'failed') then
    update public.orders
       set payment_status = p_payment_status,
           stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
           updated_at = now()
     where id = target_order.id;
    target_order.payment_status := p_payment_status;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_status', target_order.payment_status);
end;
$$;

revoke all on function public.process_stripe_payment_event(text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.process_stripe_payment_event(text, text, text, uuid, text, text) to service_role;

alter table public.orders enable row level security;
revoke all on table public.orders from public, anon, authenticated;
grant all on table public.orders to service_role;
alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;
