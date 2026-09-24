-- A bot keeps its Team thread; the main assistant may add one Personal thread.
CREATE TYPE "ThreadKind" AS ENUM ('team', 'personal');

ALTER TABLE "threads" ADD COLUMN "kind" "ThreadKind" NOT NULL DEFAULT 'team';

DROP INDEX "threads_botId_key";

CREATE UNIQUE INDEX "threads_botId_kind_key" ON "threads"("botId", "kind");
