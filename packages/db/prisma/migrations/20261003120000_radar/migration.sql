-- Radar: profile, watched sources, observed signals and delivered briefs (docs/proactive-layer.md).
-- CreateTable
CREATE TABLE "radar_profiles" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "learned" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastCycleAt" TIMESTAMP(3),
    "nextCycleAt" TIMESTAMP(3),
    "briefRequestedAt" TIMESTAMP(3),
    "lastBriefs" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_profiles_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "radar_sources" (
    "connectionId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "lastCheckAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "seenDate" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_sources_pkey" PRIMARY KEY ("connectionId")
);

-- CreateTable
CREATE TABLE "radar_signals" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actor" JSONB,
    "direct" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "importance" INTEGER,
    "urgency" TEXT,
    "action" TEXT,
    "headline" TEXT,
    "why" TEXT,
    "nextStep" TEXT,
    "offer" TEXT,
    "evidence" TEXT,
    "storyKey" TEXT,
    "confidence" DOUBLE PRECISION,
    "disposition" TEXT,
    "reason" TEXT,
    "trace" JSONB,
    "deliverAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveryKey" TEXT,
    "messageId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "snoozedUntil" TIMESTAMP(3),
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_briefs" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "messageId" TEXT,
    "signalIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radar_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radar_profiles_nextCycleAt_idx" ON "radar_profiles"("nextCycleAt");

-- CreateIndex
CREATE INDEX "radar_sources_spaceId_userId_idx" ON "radar_sources"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "radar_sources_enabled_nextCheckAt_idx" ON "radar_sources"("enabled", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "radar_signals_deliveryKey_key" ON "radar_signals"("deliveryKey");

-- CreateIndex
CREATE INDEX "radar_signals_spaceId_userId_occurredAt_idx" ON "radar_signals"("spaceId", "userId", "occurredAt");

-- CreateIndex
CREATE INDEX "radar_signals_spaceId_userId_state_disposition_idx" ON "radar_signals"("spaceId", "userId", "state", "disposition");

-- CreateIndex
CREATE INDEX "radar_signals_spaceId_userId_status_idx" ON "radar_signals"("spaceId", "userId", "status");

-- CreateIndex
CREATE INDEX "radar_signals_spaceId_userId_storyKey_idx" ON "radar_signals"("spaceId", "userId", "storyKey");

-- CreateIndex
CREATE INDEX "radar_signals_spaceId_userId_feedback_feedbackAt_idx" ON "radar_signals"("spaceId", "userId", "feedback", "feedbackAt");

-- CreateIndex
CREATE INDEX "radar_signals_connectionId_threadKey_idx" ON "radar_signals"("connectionId", "threadKey");

-- CreateIndex
CREATE INDEX "radar_signals_deliverAt_idx" ON "radar_signals"("deliverAt");

-- CreateIndex
CREATE INDEX "radar_signals_state_snoozedUntil_idx" ON "radar_signals"("state", "snoozedUntil");

-- CreateIndex
CREATE INDEX "radar_signals_createdAt_idx" ON "radar_signals"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "radar_signals_connectionId_externalId_contentHash_key" ON "radar_signals"("connectionId", "externalId", "contentHash");

-- CreateIndex
CREATE INDEX "radar_briefs_spaceId_userId_createdAt_idx" ON "radar_briefs"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "radar_briefs_spaceId_userId_period_localDate_key" ON "radar_briefs"("spaceId", "userId", "period", "localDate");

-- AddForeignKey
ALTER TABLE "radar_profiles" ADD CONSTRAINT "radar_profiles_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_profiles" ADD CONSTRAINT "radar_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_sources" ADD CONSTRAINT "radar_sources_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_sources" ADD CONSTRAINT "radar_sources_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "radar_profiles"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_signals" ADD CONSTRAINT "radar_signals_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "radar_profiles"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_signals" ADD CONSTRAINT "radar_signals_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_signals" ADD CONSTRAINT "radar_signals_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_briefs" ADD CONSTRAINT "radar_briefs_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "radar_profiles"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_briefs" ADD CONSTRAINT "radar_briefs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
