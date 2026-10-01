-- Delegated work keeps its state, budget and review outcome on the existing task row.
ALTER TABLE "tasks" ADD COLUMN "delegation" JSONB;
