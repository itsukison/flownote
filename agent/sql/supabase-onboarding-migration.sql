-- Flownote Onboarding Flags Migration
-- Adds onboarding completion flag to profiles (legacy setup/tutorial remain for compatibility)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'setup_completed'
    ) THEN
      ALTER TABLE public.profiles ADD COLUMN setup_completed boolean NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'tutorial_completed'
    ) THEN
      ALTER TABLE public.profiles ADD COLUMN tutorial_completed boolean NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarding_completed'
    ) THEN
      ALTER TABLE public.profiles ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
    END IF;

    -- Backfill onboarding_completed from legacy flags
    UPDATE public.profiles
      SET onboarding_completed = true
    WHERE onboarding_completed = false
      AND (setup_completed = true OR tutorial_completed = true);

    -- Ensure RLS is enabled
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    -- Add policy for users to read/update their own profile if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_self_onboarding'
    ) THEN
      CREATE POLICY "profiles_self_onboarding" ON public.profiles
        FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
    END IF;
  END IF;
END $$;
