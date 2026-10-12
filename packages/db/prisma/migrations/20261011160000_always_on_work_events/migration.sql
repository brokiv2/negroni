ALTER TABLE "assistant_work"
  ADD COLUMN "eventWatches" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "watchSince" TIMESTAMP(3),
  ADD COLUMN "watchGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "recoveryAt" TIMESTAMP(3),
  ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "radar_signals" ADD COLUMN "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "radar_signals_spaceId_userId_observedAt_id_idx"
  ON "radar_signals"("spaceId", "userId", "observedAt", "id");

CREATE TABLE "assistant_work_events" (
  "id" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "workVersion" INTEGER NOT NULL,
  "watchGeneration" INTEGER NOT NULL,
  "eventKey" TEXT NOT NULL,
  "signalId" TEXT,
  "snapshot" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "runId" TEXT,
  CONSTRAINT "assistant_work_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_work_events_workId_fkey" FOREIGN KEY ("workId")
    REFERENCES "assistant_work"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_work_events_signalId_fkey" FOREIGN KEY ("signalId")
    REFERENCES "radar_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "assistant_work_events_workId_eventKey_key"
  ON "assistant_work_events"("workId", "eventKey");
CREATE INDEX "assistant_work_events_workId_workVersion_watchGeneration_co_idx"
  ON "assistant_work_events"("workId", "workVersion", "watchGeneration", "consumedAt");
