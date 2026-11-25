-- Blog feed composite visibility index & drop redundant short_id index

CREATE INDEX IF NOT EXISTS idx_blog_posts_user_vis_pub
  ON blog_posts(user_id, visibility, is_pinned DESC, published_at DESC, created_at DESC);

DROP INDEX IF EXISTS idx_blog_posts_short_id;
