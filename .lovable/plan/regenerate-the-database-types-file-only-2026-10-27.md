Regenerate the database types file only

Answers:
1. Tool: the built-in type generator (supabase--get_types). It reads the live database schema and writes its output straight to src/integrations/supabase/types.ts. I don't write the file by hand.
2. No full guarantee. The tool writes only types.ts. It runs no migration and makes no schema change. But it overwrites the whole file, so formatting or ordering inside types.ts may change. The automatic post-edit checks don't edit files. I'll confirm afterward with a diff that lists every changed file.
3. Not guaranteed to be additions only. Existing definitions stay the same only if the live schema matches the current file. Any drift will show up: columns or functions changed outside Lovable, or differences between generator versions. The diff will show this.
4. Yes. Lovable saves each change as a commit on the active branch, and GitHub sync pushes it if connected (currently main). This is not a separate approval step.

Steps if approved:
1. Run the type generator once.
2. Show the diff and the list of changed files. Report any change to the existing 11 tables or 8 functions.
3. Make no other edits.
