-- No daily upload limit (2026-11-24, owner). Browser uploads were capped at 20 files a student a day
-- (decision 10); a couple of folders and their retries reached it while most of the day's AI allowance
-- was unused. The model work stays bounded by the per-student pages and tokens a day and the global
-- budget; storage is bounded only by the 50 MB per-file limit now. The admission still records its
-- receipt (rate_charged), which binding and attaching a browser item require, so items still have to
-- come through the upload route. Replaced in place, so its service-role-only privileges stay.
create or replace function public.pipeline_charge_item(payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare i public.pipeline_items;
begin
 select * into i from public.pipeline_items where id=(payload->>'itemId')::uuid and owner_id=(payload->>'ownerId')::uuid for update;
 if i.id is null then raise exception 'No admission' using errcode='42501'; end if;
 if not i.rate_charged then update public.pipeline_items set rate_charged=true where id=i.id; end if;
 return i.state not in ('failed','cancelled');
end; $$;
