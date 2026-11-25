-- Slide previews (2026-11-24): every page of an uploaded PDF drawn small on the server while the upload
-- is processed ("<owner>/<material id>/<page>.jpg"), so "Which slides were hard?" loads small images
-- instead of the whole file and pdf.js. A private bucket: the student reads their own folder; only the
-- server (service role) writes or removes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbnails', 'thumbnails', false, 1048576, array['image/jpeg']);

create policy "own previews: read" on storage.objects for select to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);
