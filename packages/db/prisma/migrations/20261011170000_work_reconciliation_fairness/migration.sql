ALTER TABLE "assistant_work"
  ADD COLUMN "watchScannedAt" TIMESTAMP(3),
  ADD COLUMN "reconciledAt" TIMESTAMP(3);
CREATE INDEX "assistant_work_watchScannedAt_idx" ON "assistant_work"("watchScannedAt");
CREATE INDEX "assistant_work_reconciledAt_idx" ON "assistant_work"("reconciledAt");
