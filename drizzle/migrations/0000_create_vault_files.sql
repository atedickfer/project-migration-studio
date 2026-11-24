CREATE TABLE public.vault_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  root text NOT NULL DEFAULT 'downloads',
  folder text NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  source_url text,
  size bigint NOT NULL DEFAULT 0,
  content_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_path),
  UNIQUE (user_id, root, folder, name)
);
CREATE INDEX vault_files_user_root_idx ON public.vault_files (user_id, root, folder);
CREATE INDEX vault_files_source_idx ON public.vault_files (user_id, root, folder, source_url);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_files TO authenticated;
GRANT ALL ON public.vault_files TO service_role;

ALTER TABLE public.vault_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their vault files" ON public.vault_files
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners add vault files" ON public.vault_files
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update vault files" ON public.vault_files
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete vault files" ON public.vault_files
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owners read vault objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners upload vault objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners update vault objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners delete vault objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vault' AND (storage.foldername(name))[1] = auth.uid()::text);