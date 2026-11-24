-- Add AI cover image generation settings to user_preferences and per-category cover prompts

ALTER TABLE user_preferences ADD COLUMN ai_image_api_url TEXT;
ALTER TABLE user_preferences ADD COLUMN ai_image_api_key TEXT;
ALTER TABLE user_preferences ADD COLUMN ai_image_model TEXT;
ALTER TABLE user_preferences ADD COLUMN ai_cover_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN ai_cover_style TEXT;
ALTER TABLE categories ADD COLUMN cover_prompt TEXT;
