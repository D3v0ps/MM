-- 0028 Mejlinläsningens bilagor (beslut 4c, 2026-10-08, SPEC §7.1).
-- Filbilagor i mejl till avrop@ sparas av inläsningsjobbet (inbox_import, service role) som ärendets bilagor innan ärendet
-- finns, med uploaded_by = 'system' – systemaktören har ingen profil. Främmande nyckeln till profiles tas därför bort.
-- Kolumnen är fortfarande obligatorisk, RLS är oförändrad (den egna uppladdningen jämförs med mm.current_profile_id(),
-- som aldrig är 'system') och ingen annan tabell ändras. Idempotent: kan köras igen.
alter table public.case_attachments drop constraint if exists case_attachments_uploaded_by_fkey;
comment on column public.case_attachments.uploaded_by is 'profiles.id för den som laddade upp, eller ''system'' för bilagor ur inlästa mejl (jobbet inbox_import, beslut 4c 2026-10-08).';
