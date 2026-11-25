-- Say why an upload waits (2026-11-24, owner). A call reserves a generous estimate of its tokens
-- before it runs; the check counted those holds as spent, so five files reading at once could read
-- "Not enough remaining model allowance. Processing resumes tomorrow." with most of the day's
-- allowance unused, and then carry on a minute later. Now: actually used up says so (and tomorrow);
-- held by other calls still running says it continues shortly. The limits themselves are unchanged.
-- Replaced in place, so its service-role-only privileges stay as they were.
create or replace function public.pipeline_reserve_call(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid=(payload->>'ownerId')::uuid; day timestamptz=(payload->>'dayStart')::timestamptz; utc timestamptz=(payload->>'utcStart')::timestamptz; spent bigint; held bigint; lost bigint; lost_usd numeric; dollars numeric; reserved numeric; amount bigint=(payload->>'tokens')::bigint; price numeric=(payload->>'usd')::numeric; cap numeric=(payload->>'globalCap')::numeric; rid uuid=(payload->>'id')::uuid;
begin
 if amount<0 or price<0 or day is null or utc is null then raise exception 'Invalid reservation'; end if;
 -- Lock order: owner tokens/permits, then the course row (the task check, as pipeline_pages does),
 -- and the global dollar lock last, so no owner waits on another owner's course while holding it.
 perform pg_advisory_xact_lock(hashtextextended(o::text,32));
 if payload ? 'taskId' then perform private.pipeline_task(payload); end if;
 if payload ? 'runToken' and not exists(select 1 from public.pipeline_runs where id=(payload->>'runId')::uuid and owner_id=o and execution_token=(payload->>'runToken')::uuid and status='running') then raise exception 'Writer replaced before model call' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(91337001);
 update public.pipeline_call_reservations set state='unknown' where state='active' and lease_until<now();
 -- An unknown hold whose usage was metered after all (a cut-off reply) is counted in model_usage: release it.
 update public.pipeline_call_reservations r set state='settled' where r.state='unknown' and r.utc_start>=utc-interval '1 day' and exists(select 1 from public.model_usage u where u.attempt_id=r.id);
 -- Every call, grading included, takes a provider slot (ORCA_MODEL_CONCURRENCY) and the budgets.
 if (select count(*) from public.pipeline_call_reservations where state='active')>=coalesce((payload->>'providerSlots')::integer,20) then
  return jsonb_build_object('ok',false,'reason','capacity','message','Waiting for a free slot to call the AI. It continues by itself shortly.');
 end if;
 select coalesce(sum(input_tokens::bigint+output_tokens+cache_write_tokens+cache_read_tokens),0) into spent from public.model_usage where owner_id=o and at>=day;
 -- A lost reply (unknown) was probably paid for: it counts as spent. Calls still running (active) are only held.
 select coalesce(sum(tokens) filter (where state='unknown'),0), coalesce(sum(tokens) filter (where state='active'),0) into lost, held from public.pipeline_call_reservations where owner_id=o and day_start=day and state in ('active','unknown');
 if spent+lost+amount>2000000 then return jsonb_build_object('ok',false,'reason','daily-tokens','message','Today''s AI allowance is used up. Orca builds this when it resets tomorrow, and it appears here.'); end if;
 -- Not used up: other calls still running hold their (generous) estimates. They settle in a minute or two.
 if spent+lost+held+amount>2000000 then return jsonb_build_object('ok',false,'reason','held','message','Waiting for your other files'' AI calls to finish, so today''s AI allowance isn''t overspent. It continues by itself shortly.'); end if;
 select coalesce(sum(cost_usd),0) into dollars from public.model_usage where at>=utc;
 select coalesce(sum(usd) filter (where state='unknown'),0), coalesce(sum(usd) filter (where state='active'),0) into lost_usd, reserved from public.pipeline_call_reservations where utc_start=utc and state in ('active','unknown');
 if cap is not null and dollars+lost_usd+price>cap then return jsonb_build_object('ok',false,'reason','global-budget','message','Orca''s AI budget for today is used up. Orca builds this when it resets tomorrow, and it appears here.'); end if;
 if cap is not null and dollars+lost_usd+reserved+price>cap then return jsonb_build_object('ok',false,'reason','held','message','Waiting for other AI calls to finish, so Orca''s AI budget for today isn''t overspent. It continues by itself shortly.'); end if;
 insert into public.pipeline_call_reservations(id,owner_id,run_id,task_id,task_token,day_start,utc_start,tokens,usd,kind,lease_until) values(rid,o,(payload->>'runId')::uuid,(payload->>'taskId')::uuid,(payload->>'token')::uuid,day,utc,amount,price,payload->>'kind',now()+interval '12 minutes') on conflict do nothing;
 return jsonb_build_object('ok',true);
end; $$;
