-- Integrations (2026-11-25): the calendar feed token is the server's to set; Notion connections and
-- links are service-role only, one link per Notion page.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

\set A aaaaaaaa-0000-4000-8000-000000000291

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a29@example.com');

select pg_temp.act_as(:'A');
select throws_ok($$update public.profiles set calendar_feed_token = 'abcdefghijklmnopqrstuvwxyz012345' where owner_id = auth.uid()$$, '42501', null, 'a student can''t mint their own feed token');
select is((select count(*) from public.notion_connections) + (select count(*) from public.notion_links), 0::bigint, 'the student''s own session sees no Notion rows');
reset role;

select lives_ok(format($$update public.profiles set calendar_feed_token = 'abcdefghijklmnopqrstuvwxyz012345' where owner_id = %L$$, :'A'), 'the server mints it');
select throws_ok(format($$update public.profiles set calendar_feed_token = 'short' where owner_id = %L$$, :'A'), '23514', null, 'and it has to look like one');
select lives_ok(format($$insert into public.notion_links (owner_id, page_id, material_id) values (%L, 'p1', gen_random_uuid())$$, :'A'), 'a Notion link can be stored');
select throws_ok(format($$insert into public.notion_links (owner_id, page_id, material_id) values (%L, 'p1', gen_random_uuid())$$, :'A'), '23505', null, 'one link per Notion page');

select * from finish();
rollback;
