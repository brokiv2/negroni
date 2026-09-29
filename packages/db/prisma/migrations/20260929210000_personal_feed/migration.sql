CREATE TABLE "feed_items" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
 "threadId" TEXT NOT NULL UNIQUE REFERENCES "threads"("id") ON DELETE CASCADE,
 "dedupKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL,
 "content" TEXT NOT NULL, "url" TEXT, "imageUrl" TEXT, "reason" TEXT NOT NULL DEFAULT '', "topic" TEXT NOT NULL DEFAULT '',
 "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "saved" BOOLEAN NOT NULL DEFAULT false, "hidden" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "feed_items_spaceId_userId_dedupKey_key" ON "feed_items"("spaceId", "userId", "dedupKey");
CREATE INDEX "feed_items_spaceId_userId_createdAt_idx" ON "feed_items"("spaceId", "userId", "createdAt");
