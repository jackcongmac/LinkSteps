-- Allow the creator of a senior_profiles row to update it.
-- The existing DB only had a public SELECT policy; UPDATE was silently blocked by RLS.
CREATE POLICY "senior_profiles: creator can update"
  ON senior_profiles
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
