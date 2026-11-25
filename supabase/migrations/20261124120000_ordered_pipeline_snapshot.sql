-- The staged structure worker's snapshot in stored order (2026-11-24), as my_data reads it. Without
-- an ORDER BY the topics came back in heap order, and the worker lays topics out on the path by
-- array index (laidOut), so stored positions drifted from the trail order and "Show all" zigzagged.
-- Ordering also keeps the table of contents the model sees in course order.
create or replace function public.pipeline_snapshot(payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.courses;
begin
 select * into c from public.courses where id=(payload->>'courseId')::uuid and owner_id=(payload->>'ownerId')::uuid and deleted_at is null;
 if c.id is null then raise exception 'No course' using errcode='42501'; end if;
 return jsonb_build_object('revision',c.structure_revision,'course',to_jsonb(c),'structure',public.course_structure(c.id,c.owner_id),
 'topics',coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order,t.id) from public.topics t where t.course_id=c.id),'[]'),
 'objectives',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from public.objectives t where t.course_id=c.id),'[]'),
 'relations',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from public.relations t where t.course_id=c.id),'[]'),
 'questions',coalesce((select jsonb_agg(to_jsonb(t) order by t.topic_id,t.sort_order,t.id) from public.questions t where t.course_id=c.id),'[]'));
end; $$;
