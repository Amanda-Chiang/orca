import assert from "node:assert/strict";
import { test } from "node:test";
import { filenameFromDisposition, parseGoogleLink } from "../src/lib/google-link.ts";

test("Docs, Slides, Sheets and Drive links map to a file Google serves without credentials", () => {
  assert.deepEqual(parseGoogleLink("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing"), {
    kind: "doc",
    id: "1AbCdEfGhIjKlMnOp",
    exportUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=pdf",
    fallbackName: "Google Doc 1AbCdEfG.pdf",
  });
  assert.equal(parseGoogleLink("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit#slide=id.p")?.exportUrl, "https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/export/pdf");
  assert.equal(parseGoogleLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit")?.kind, "sheet");
  assert.equal(parseGoogleLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drive_link")?.exportUrl, "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
  assert.equal(parseGoogleLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")?.id, "1AbCdEfGhIjKlMnOp");
});

test("anything else is not a Google link", () => {
  assert.equal(parseGoogleLink("https://example.edu/course"), null);
  assert.equal(parseGoogleLink("http://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit"), null, "https only");
  assert.equal(parseGoogleLink("https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/viewform"), null);
  assert.equal(parseGoogleLink("not a url"), null);
});

test("the file name comes from Content-Disposition, RFC 5987 first", () => {
  assert.equal(filenameFromDisposition("attachment; filename=\"Lecture 3.pdf\"; filename*=UTF-8''Lecture%203%20%E2%80%93%20Nodal.pdf"), "Lecture 3 – Nodal.pdf");
  assert.equal(filenameFromDisposition('attachment; filename="HW09.pdf"'), "HW09.pdf");
  assert.equal(filenameFromDisposition(null), null);
});
