-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "workId" TEXT,
ADD COLUMN     "workVersion" INTEGER;

-- CreateTable
CREATE TABLE "assistant_work" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "authorization" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextWakeAt" TIMESTAMP(3),
    "wakeReason" TEXT NOT NULL,
    "lastResult" TEXT NOT NULL DEFAULT '',
    "activeRunId" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "maxRuns" INTEGER NOT NULL DEFAULT 24,
    "deadline" TIMESTAMP(3) NOT NULL,
    "modelProvider" TEXT,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_work_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_work_creationKey_key" ON "assistant_work"("creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_work_activeRunId_key" ON "assistant_work"("activeRunId");

-- CreateIndex
CREATE INDEX "assistant_work_status_nextWakeAt_idx" ON "assistant_work"("status", "nextWakeAt");

-- CreateIndex
CREATE INDEX "assistant_work_spaceId_userId_threadId_idx" ON "assistant_work"("spaceId", "userId", "threadId");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_workId_fkey" FOREIGN KEY ("workId") REFERENCES "assistant_work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_work" ADD CONSTRAINT "assistant_work_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_work" ADD CONSTRAINT "assistant_work_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_work" ADD CONSTRAINT "assistant_work_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_work" ADD CONSTRAINT "assistant_work_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

