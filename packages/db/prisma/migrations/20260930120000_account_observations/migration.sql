ALTER TABLE "feed_research" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'public';
CREATE TABLE "account_observations" (
  "connectionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_observations_pkey" PRIMARY KEY ("connectionId", "documentId"),
  CONSTRAINT "account_observations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
