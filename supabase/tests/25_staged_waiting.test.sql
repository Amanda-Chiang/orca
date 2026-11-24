begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000251','stage25@example.com'),('bbbbbbbb-0000-4000-8000-000000000251','other25@example.com');
insert into public.courses(id,owner_id,slug,name,short,variant,pos_x,pos_y) values('c0000000-0000-4000-8000-000000000251','aaaaaaaa-0000-4000-8000-000000000251','stage25','Stage','ST','ald',0,0);
select public.pipeline_enable('{"enabled":true}');
create temp table calls(name text primary key, value jsonb);
insert into calls values('admit',public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251","courseId":"c0000000-0000-4000-8000-000000000251","batchId":"d0000000-0000-4000-8000-000000000251","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000251","name":"First.pdf"},{"id":"e0000000-0000-4000-8000-000000000252","name":"Second.pdf"}]}'));
insert into public.materials(id,owner_id,course_id,filename,type,status,content_hash) values
 ('f0000000-0000-4000-8000-000000000251','aaaaaaaa-0000-4000-8000-000000000251','c0000000-0000-4000-8000-000000000251','First.pdf','Lecture','ready','first-hash'),
 ('f0000000-0000-4000-8000-000000000252','aaaaaaaa-0000-4000-8000-000000000251','c0000000-0000-4000-8000-000000000251','Second.pdf','Lecture','ready','second-hash');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251","itemId":"e0000000-0000-4000-8000-000000000251"}');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251","itemId":"e0000000-0000-4000-8000-000000000252"}');
-- Second bytes arrive first, but that cannot change the structure lane order.
insert into calls values('second',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251","itemId":"e0000000-0000-4000-8000-000000000252","materialId":"f0000000-0000-4000-8000-000000000252","model":"gpt-6.1-sol"}'));
insert into calls values('prep2',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251"}'));
select public.pipeline_task((select value from calls where name='prep2'));
-- A worker told to wait parks its phase as waiting instead of failing silently (2026-11-24).
insert into calls values('first',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251","itemId":"e0000000-0000-4000-8000-000000000251","materialId":"f0000000-0000-4000-8000-000000000251","model":"gpt-6.1-sol"}'));
insert into calls values('prep1',public.pipeline_claim('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000251"}'));
select public.pipeline_task((select value from calls where name='prep1'));
select lives_ok(format('select public.pipeline_fail(%L::jsonb)',(select value from calls where name='prep1')||'{"waiting":true,"error":"Waiting for model capacity."}'),'a deferred worker can park its phase');
select is((select state from public.pipeline_tasks where id=((select value from calls where name='prep1')->>'taskId')::uuid),'waiting','the phase waits');
select is((select status||'|'||coalesce(error,'none')||'|'||(progress->>'message') from public.pipeline_runs where id=(select run_id from public.pipeline_tasks where id=((select value from calls where name='prep1')->>'taskId')::uuid)),'waiting|none|Waiting for model capacity.','the run waits, with the reason in its progress and no error');
select * from finish();
rollback;
