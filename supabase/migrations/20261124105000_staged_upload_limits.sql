-- No per-student cap on model calls running at once (owner, 2026-11-24). The cap of four made a
-- student's own uploads defer each other mid-reading; the provider slots (ORCA_MODEL_CONCURRENCY,
-- default twenty), the daily token allowance and the global dollar ceiling still apply. Replaced in
-- place, so its service-role-only privileges stay as they were.
create or replace function public.pipeline_reserve_call(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid=(payload->>'ownerId')::uuid; day timestamptz=(payload->>'dayStart')::timestamptz; utc timestamptz=(payload->>'utcStart')::timestamptz; spent bigint; held bigint; dollars numeric; reserved numeric; amount bigint=(payload->>'tokens')::bigint; price numeric=(payload->>'usd')::numeric; cap numeric=(payload->>'globalCap')::numeric; rid uuid=(payload->>'id')::uuid;
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
  return jsonb_build_object('ok',false,'reason','capacity','message','Waiting for model capacity.');
 end if;
 select coalesce(sum(input_tokens::bigint+output_tokens+cache_write_tokens+cache_read_tokens),0) into spent from public.model_usage where owner_id=o and at>=day;
 select coalesce(sum(tokens),0) into held from public.pipeline_call_reservations where owner_id=o and day_start=day and state in ('active','unknown');
 if spent+held+amount>2000000 then return jsonb_build_object('ok',false,'reason','daily-tokens','message','Not enough remaining model allowance. Processing resumes tomorrow.'); end if;
 select coalesce(sum(cost_usd),0) into dollars from public.model_usage where at>=utc;
 select coalesce(sum(usd),0) into reserved from public.pipeline_call_reservations where utc_start=utc and state in ('active','unknown');
 if cap is not null and dollars+reserved+price>cap then return jsonb_build_object('ok',false,'reason','global-budget','message','Orca model budget is reserved or used for today.'); end if;
 insert into public.pipeline_call_reservations(id,owner_id,run_id,task_id,task_token,day_start,utc_start,tokens,usd,kind,lease_until) values(rid,o,(payload->>'runId')::uuid,(payload->>'taskId')::uuid,(payload->>'token')::uuid,day,utc,amount,price,payload->>'kind',now()+interval '12 minutes') on conflict do nothing;
 return jsonb_build_object('ok',true);
end; $$;

-- Reading pages (owner, 2026-11-24): five files per student at once instead of two, now that a
-- student's calls aren't capped at four; up to ten tasks per student at once instead of six.
create or replace function public.pipeline_claim(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; i public.pipeline_items; claim_token uuid=gen_random_uuid(); o uuid=(payload->>'ownerId')::uuid;
begin
 -- Serialize scheduler decisions per owner; a distinct course lease is backed by a unique index.
 perform pg_advisory_xact_lock(hashtextextended(o::text,31));
 if (select count(*) from public.pipeline_tasks where owner_id=o and state in ('dispatched','running') and lease_until>now())>=10 then return null; end if;
 update public.pipeline_items set state='failed',error='Upload interrupted. Send this file again.' where owner_id=o and state='ingesting' and expires_at<now();
 update public.pipeline_tasks set state='queued',epoch=epoch+1,token=null,available_at=now(),error='Worker interrupted; resuming checkpoint' where owner_id=o and state in ('dispatched','running') and lease_until<now();
 for t in select s.* from public.pipeline_tasks s join public.pipeline_items x on x.run_id=s.run_id and x.state='active' join public.pipeline_runs r on r.id=s.run_id join public.courses c on c.id=s.course_id
  where s.owner_id=o and s.state in ('queued','waiting') and s.available_at<=now() and not x.paused and r.status not in ('done','failed') and c.deleted_at is null
  order by case s.phase when 'questions' then 0 when 'structure' then 1 else 2 end,x.sequence loop
  perform 1 from public.courses where id=t.course_id and deleted_at is null for update;
  if not found then continue; end if;
  perform 1 from public.pipeline_runs where id=t.run_id and status not in ('done','failed') for update;
  if not found or exists(select 1 from public.pipeline_items where run_id=t.run_id and paused) then continue; end if;
  if t.phase='prepare' and (select count(*) from public.pipeline_tasks where owner_id=o and phase='prepare' and state in ('dispatched','running'))>=5 then continue; end if;
  if t.phase='structure' then
   if exists(select 1 from public.pipeline_tasks where course_id=t.course_id and phase='structure' and state in ('dispatched','running')) then continue; end if;
   select * into i from public.pipeline_items where run_id=t.run_id and state='active' order by sequence limit 1;
   if exists(select 1 from public.pipeline_items a left join public.pipeline_runs ar on ar.id=a.run_id where a.course_id=t.course_id and a.sequence<i.sequence and not a.paused and a.state in ('ingesting','active') and (ar.id is null or (ar.structure_committed_at is null and ar.status<>'failed'))) then continue; end if;
  end if;
  update public.pipeline_tasks set state='dispatched',epoch=epoch+1,token=claim_token,lease_until=now()+interval '12 minutes',attempts=attempts+1 where id=t.id;
  update public.pipeline_runs set status='running',phase=t.phase,started_at=now(),error=null,progress=jsonb_build_object('stage',t.phase) where id=t.run_id;
  return jsonb_build_object('ownerId',o,'taskId',t.id,'token',claim_token);
 end loop;
 return null;
end; $$;

-- A worker told to wait (model capacity, budget, a busy objective) parks its phase as waiting. The
-- run then carries no error, since pipeline_runs allows one only on a failed run
-- (pipeline_runs_check): with it set, this update was refused, the worker ended silently, and the
-- phase stayed running until its twelve-minute lease ran out. The reason stays in progress.message
-- and on the task row.
create or replace function public.pipeline_fail(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.pipeline_tasks; waiting boolean=coalesce((payload->>'waiting')::boolean,false);
begin
 t=private.pipeline_task(payload);
 delete from public.pipeline_question_claims where run_id=t.run_id and token=t.token;
 update public.pipeline_tasks set state=case when waiting then 'waiting' else 'failed' end,error=left(payload->>'error',800),available_at=now()+interval '1 minute',lease_until=null where id=t.id;
 update public.pipeline_runs set status=case when waiting then 'waiting' else 'failed' end,error=case when waiting then null else left(payload->>'error',800) end,progress=case when waiting then jsonb_build_object('stage','waiting','message',payload->>'error') else null end where id=t.run_id;
 return '{}';
end; $$;
