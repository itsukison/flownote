-- Flownote Prompts Migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/.../sql

-- 1. Create Prompts Table
CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  prompt_type TEXT NOT NULL DEFAULT 'base',  -- 'base' | 'rag'
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Allow users to fully manage their own prompts
DROP POLICY IF EXISTS "prompts_self" ON prompts;
CREATE POLICY "prompts_self" ON prompts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Add selected_base_prompt_id and selected_rag_prompt_id to profiles table
-- (Assuming a profiles table exists. If not, you may need to track this differently or wait for a profiles table migration)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles') THEN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'selected_base_prompt_id') THEN
      ALTER TABLE profiles ADD COLUMN selected_base_prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'selected_rag_prompt_id') THEN
      ALTER TABLE profiles ADD COLUMN selected_rag_prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 3. Create a trigger function to automatically insert default prompts for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_prompts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  base_prompt_id UUID;
  rag_prompt_id UUID;
BEGIN
  -- Insert default base prompt
  INSERT INTO public.prompts (user_id, name, content, prompt_type, is_default)
  VALUES (
    NEW.id, 
    'デフォルト基本プロンプト', 
    'あなたは商談中の日本のビジネスパーソンをサポートする優秀なAIアシスタントです。質問に対する回答のみを、適切なビジネス日本語（敬語・謙譲語・丁寧語）で簡潔に提供してください。「承知いたしました」「はい、お答えします」などのメタ発言や挨拶は一切不要です。直接結論から述べてください。', 
    'base', 
    true
  ) RETURNING id INTO base_prompt_id;

  -- Insert default RAG prompt
  INSERT INTO public.prompts (user_id, name, content, prompt_type, is_default)
  VALUES (
    NEW.id, 
    'デフォルトRAGプロンプト', 
    'あなたは商談中の日本のビジネスパーソンをサポートする優秀なAIアシスタントです。質問に対する回答のみを、適切なビジネス日本語（敬語・謙譲語・丁寧語）で簡潔に提供してください。「承知いたしました」「はい、お答えします」などのメタ発言や挨拶は一切不要です。直接結論から述べてください。\n\n以下の自社に関する参考資料（コンテキスト）をもとに、質問に回答してください。資料に答えがない場合は、その旨を丁寧に伝えてください。\n\n{{context}}\n\n質問: {{question}}', 
    'rag', 
    true
  ) RETURNING id INTO rag_prompt_id;

  -- Optional: automatically select the default prompts for the new user profile if 'profiles' exists
  -- UPDATE public.profiles SET selected_base_prompt_id = base_prompt_id, selected_rag_prompt_id = rag_prompt_id WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Note: Ensure this trigger is attached to auth.users if you want it to run automatically on sign up.
-- DROP TRIGGER IF EXISTS on_auth_user_created_prompts ON auth.users;
-- CREATE TRIGGER on_auth_user_created_prompts
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_prompts();
