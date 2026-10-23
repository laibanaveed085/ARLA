alter table public.orders
  add column if not exists payment_status text not null default 'manual',
  add column if not exists checkout_request_id uuid,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

alter table public.orders enable row level security;
revoke all on table public.orders from public, anon, authenticated;
grant all on table public.orders to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'orders_payment_status_check'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('manual', 'pending', 'paid', 'failed', 'canceled'));
  end if;
end;
$$;

create unique index if not exists orders_checkout_request_id_uidx
  on public.orders (checkout_request_id);
create unique index if not exists orders_stripe_checkout_session_id_uidx
  on public.orders (stripe_checkout_session_id);
create unique index if not exists orders_stripe_payment_intent_id_uidx
  on public.orders (stripe_payment_intent_id);
create index if not exists orders_payment_status_created_at_idx
  on public.orders (payment_status, created_at desc);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public, anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

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
