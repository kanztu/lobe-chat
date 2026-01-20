ALTER TABLE "agent_triggers" ADD COLUMN "next_scheduled_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_triggers_next_scheduled_at_idx" ON "agent_triggers" USING btree ("enabled","trigger_type","next_scheduled_at") WHERE "enabled" = true AND "trigger_type" = 'cron';
