-- PostGIS must exist before the geography column type is used. Added by
-- hand (drizzle-kit does not emit extension statements); apply-migrations.ts
-- also runs this with IF NOT EXISTS for already-provisioned databases.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "availability" (
	"property_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"nightly_price" numeric,
	CONSTRAINT "availability_property_id_date_pk" PRIMARY KEY("property_id","date")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text NOT NULL,
	"radius_meters" integer NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"search_event_id" uuid,
	"check_in" date,
	"check_out" date,
	"guests" integer,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"market" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"location" geography(point, 4326) NOT NULL,
	"address" text,
	"property_type" text NOT NULL,
	"max_guests" integer NOT NULL,
	"bedrooms" integer NOT NULL,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_nightly" numeric NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "properties_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "search_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_hash" text NOT NULL,
	"market" text,
	"lat" double precision,
	"lng" double precision,
	"radius_miles" integer,
	"check_in" date,
	"check_out" date,
	"guests" integer,
	"filters" jsonb,
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_search_event_id_search_events_id_fk" FOREIGN KEY ("search_event_id") REFERENCES "public"."search_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_location_gix" ON "properties" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_source_external_uq" ON "properties" USING btree ("source","external_id");