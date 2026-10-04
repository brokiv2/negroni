-- Radar pipeline: presence, unread state, deadlines, held interrupts and messages about an update.
-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "radarSignalId" TEXT;

-- AlterTable
ALTER TABLE "radar_profiles" ADD COLUMN     "presenceAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "radar_signals" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "held" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unread" BOOLEAN;

-- CreateIndex
CREATE INDEX "radar_signals_connectionId_externalId_idx" ON "radar_signals"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_radarSignalId_fkey" FOREIGN KEY ("radarSignalId") REFERENCES "radar_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
