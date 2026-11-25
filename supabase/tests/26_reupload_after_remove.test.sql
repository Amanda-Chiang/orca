-- A file deleted from a course and uploaded again is built again, not aliased to the deleted copy (2026-11-24).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000261','reupload26@example.com');
insert into public.courses(id,owner_id,slug,name,short,variant,pos_x,pos_y) values('c0000000-0000-4000-8000-000000000261','aaaaaaaa-0000-4000-8000-000000000261','reupload26','Reupload','RE','ald',0,0);
select public.pipeline_enable('{"enabled":true}');
create temp table calls(name text primary key, value jsonb);

-- First copy: admitted, read, attached to its own run.
select public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","courseId":"c0000000-0000-4000-8000-000000000261","batchId":"d0000000-0000-4000-8000-000000000261","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000261","name":"Deck.pdf"}]}');
insert into public.materials(id,owner_id,course_id,filename,type,status,content_hash) values('f0000000-0000-4000-8000-000000000261','aaaaaaaa-0000-4000-8000-000000000261','c0000000-0000-4000-8000-000000000261','Deck.pdf','Lecture','ready','same-bytes');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000261"}');
insert into calls values('first',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000261","materialId":"f0000000-0000-4000-8000-000000000261","model":"stub"}'));
select is((select value->>'alias' from calls where name='first'),'false','the first copy gets its own run');

-- An identical second copy while the first is live is an alias of it, as before.
select public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","courseId":"c0000000-0000-4000-8000-000000000261","batchId":"d0000000-0000-4000-8000-000000000262","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000262","name":"Deck.pdf"}]}');
insert into public.materials(id,owner_id,course_id,filename,type,status,content_hash) values('f0000000-0000-4000-8000-000000000262','aaaaaaaa-0000-4000-8000-000000000261','c0000000-0000-4000-8000-000000000261','Deck.pdf','Lecture','ready','same-bytes');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000262"}');
insert into calls values('dup',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000262","materialId":"f0000000-0000-4000-8000-000000000262","model":"stub"}'));
select is((select value->>'runId' from calls where name='dup'),(select value->>'runId' from calls where name='first'),'a live duplicate still aliases the first copy');

-- The first copy is deleted; the same file uploaded again gets a run of its own.
select public.pipeline_remove_material('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","materialId":"f0000000-0000-4000-8000-000000000261"}');
select public.pipeline_admit('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","courseId":"c0000000-0000-4000-8000-000000000261","batchId":"d0000000-0000-4000-8000-000000000263","source":"browser","items":[{"id":"e0000000-0000-4000-8000-000000000263","name":"Deck.pdf"}]}');
insert into public.materials(id,owner_id,course_id,filename,type,status,content_hash) values('f0000000-0000-4000-8000-000000000263','aaaaaaaa-0000-4000-8000-000000000261','c0000000-0000-4000-8000-000000000261','Deck.pdf','Lecture','ready','same-bytes');
select public.pipeline_charge_item('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000263"}');
insert into calls values('again',public.pipeline_attach('{"ownerId":"aaaaaaaa-0000-4000-8000-000000000261","itemId":"e0000000-0000-4000-8000-000000000263","materialId":"f0000000-0000-4000-8000-000000000263","model":"stub"}'));
select is((select value->>'alias' from calls where name='again'),'false','after a delete, the same file is not aliased to the deleted copy');
select isnt((select value->>'runId' from calls where name='again'),(select value->>'runId' from calls where name='first'),'it gets a new run');
select is((select material_id::text from public.pipeline_runs where id=((select value from calls where name='again')->>'runId')::uuid),'f0000000-0000-4000-8000-000000000263','the new run builds the new copy');

select * from finish();
rollback;
