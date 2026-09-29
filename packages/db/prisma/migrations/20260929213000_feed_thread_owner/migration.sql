ALTER TABLE "threads" ADD COLUMN "feedItemId" TEXT;
UPDATE "threads" SET "feedItemId" = f."id" FROM "feed_items" f WHERE f."threadId" = "threads"."id";
ALTER TABLE "feed_items" DROP COLUMN "threadId";
CREATE UNIQUE INDEX "threads_feedItemId_key" ON "threads"("feedItemId");
ALTER TABLE "threads" ADD CONSTRAINT "threads_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "feed_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "threads" DROP CONSTRAINT "threads_owner_chk";
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk" CHECK (
  num_nonnulls("botId", "groupId", "externalConversationId", "feedItemId") = 1
);
