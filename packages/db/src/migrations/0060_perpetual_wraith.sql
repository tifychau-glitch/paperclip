CREATE TABLE "daemon_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_key" text NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"adapter_type" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"exit_code" integer,
	"output" text DEFAULT '' NOT NULL,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_up_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "daemon_tasks_device_key_status_idx" ON "daemon_tasks" USING btree ("device_key","status");--> statement-breakpoint
CREATE INDEX "daemon_tasks_status_idx" ON "daemon_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "daemon_tasks_created_at_idx" ON "daemon_tasks" USING btree ("created_at");