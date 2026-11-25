-- Re-uploading a deleted file builds it again (2026-11-24). An upload's bytes are claimed per course
-- (pipeline_source_claims) so a second copy of the same file becomes an alias of the first. Removing
-- a material didn't release its claim, so the same file uploaded again after a delete was aliased to
-- the removed copy's finished run: the new copy was read but never built, and the review opened the
-- old run (its file gone, so the card said "An upload"). A claim whose copy is gone (file removed, or
-- admission failed or cancelled without a run) is now taken over by the new upload, which gets its
-- own run. Replaced in place, so its service-role-only privileges stay.
create or replace function public.pipeline_attach(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items; m public.materials; canonical uuid; rid uuid; existing public.pipeline_runs;
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null or i.state in ('failed','cancelled') then raise exception 'No active admission' using errcode='42501'; end if;
 if i.source='browser' and not i.rate_charged then raise exception 'Upload admission rate check incomplete' using errcode='42501'; end if;
 if i.run_id is not null then return jsonb_build_object('runId',i.run_id,'materialId',i.material_id,'alias',i.state='alias'); end if;
 select * into m from public.materials where id=(payload->>'materialId')::uuid and owner_id=i.owner_id and course_id=i.course_id and status='ready';
 if m.id is null then raise exception 'Material not ready'; end if;
 if not coalesce((i.metadata->>'again')::boolean,false) and m.content_hash is not null then
  insert into public.pipeline_source_claims values(i.owner_id,i.course_id,'hash:'||m.content_hash,i.id) on conflict do nothing;
  -- A claim left by a copy that's gone (its file removed, or its admission failed or cancelled
  -- before it got a run) no longer stands for these bytes: this upload takes it over.
  update public.pipeline_source_claims c set item_id=i.id
   where c.owner_id=i.owner_id and c.course_id=i.course_id and c.source_key='hash:'||m.content_hash and c.item_id<>i.id
     and exists(select 1 from public.pipeline_items ci left join public.materials cm on cm.id=ci.material_id
                where ci.id=c.item_id and (ci.state in ('failed','cancelled') or (ci.material_id is not null and coalesce(cm.status,'removed')<>'ready')));
  select item_id into canonical from public.pipeline_source_claims where owner_id=i.owner_id and course_id=i.course_id and source_key='hash:'||m.content_hash;
  if canonical<>i.id then
   select run_id into rid from public.pipeline_items where id=canonical;
   if rid is null then raise exception 'Canonical upload is being attached; retry' using errcode='40001'; end if;
   update public.pipeline_items set state='alias',material_id=(select material_id from public.pipeline_items where id=canonical),run_id=rid where id=i.id;
   return jsonb_build_object('runId',rid,'materialId',(select material_id from public.pipeline_items where id=canonical),'alias',true);
  end if;
 end if;
 select * into existing from public.pipeline_runs where material_id=m.id and status in ('queued','running','waiting','paused','done') order by at desc limit 1;
 if existing.id is not null then
  update public.pipeline_items set state='alias',material_id=m.id,run_id=existing.id where id=i.id;
  return jsonb_build_object('runId',existing.id,'materialId',m.id,'alias',true);
 end if;
 rid=gen_random_uuid();
 insert into public.pipeline_runs(id,owner_id,course_id,material_id,kind,at,model,status,protocol_version,phase) values(rid,i.owner_id,i.course_id,m.id,'upload',i.created_at,payload->>'model','queued',2,'prepare');
 update public.pipeline_items set state='active',material_id=m.id,run_id=rid where id=i.id;
 insert into public.pipeline_tasks(run_id,owner_id,course_id,material_id,phase) values(rid,i.owner_id,i.course_id,m.id,'prepare');
 return jsonb_build_object('runId',rid,'materialId',m.id,'alias',false);
end; $$;
