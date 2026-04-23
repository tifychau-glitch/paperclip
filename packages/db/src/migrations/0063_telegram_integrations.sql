CREATE TABLE IF NOT EXISTS "telegram_integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "bot_token" text,
  "default_agent_id" uuid,
  "allowed_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_update_id" bigint NOT NULL DEFAULT 0,
  "last_polled_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_integrations" ADD CONSTRAINT "telegram_integrations_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_integrations" ADD CONSTRAINT "telegram_integrations_default_agent_id_agents_id_fk"
    FOREIGN KEY ("default_agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_integrations_company_unique_idx" ON "telegram_integrations" ("company_id");
