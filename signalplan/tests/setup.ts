import { randomBytes } from "node:crypto";

// Deterministic test keys — real values come from the deployment environment.
// The tests that depend on them (JWT verification, BYOK encryption) fail
// closed when unset, so tests must set them.
process.env.SUPABASE_JWT_SECRET ??= "test-only-supabase-jwt-secret-0123456789";
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

// Route tests use an injected in-memory repository; never let a developer's
// real DATABASE_URL leak into them. The RLS test uses TEST_DATABASE_URL.
delete process.env.DATABASE_URL;
