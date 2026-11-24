-- Word documents (.docx) can be uploaded as well as PDFs and .pptx decks; the server reads the body's text.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'materials';
