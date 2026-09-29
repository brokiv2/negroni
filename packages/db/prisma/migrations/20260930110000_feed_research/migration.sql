-- AlterTable
ALTER TABLE "feed_profiles" ADD COLUMN     "activeResearchId" TEXT,
ADD COLUMN     "lastResearchAt" TIMESTAMP(3),
ADD COLUMN     "nextResearchAt" TIMESTAMP(3),
ADD COLUMN     "researchError" TEXT,
ADD COLUMN     "researchVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "researchId" TEXT;

-- CreateTable
CREATE TABLE "feed_research" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "feed_research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_findings" (
    "id" TEXT NOT NULL,
    "researchId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_research_spaceId_userId_createdAt_idx" ON "feed_research"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "feed_findings_researchId_url_key" ON "feed_findings"("researchId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "feed_profiles_activeResearchId_key" ON "feed_profiles"("activeResearchId");

-- CreateIndex
CREATE UNIQUE INDEX "runs_researchId_key" ON "runs"("researchId");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "feed_research"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_research" ADD CONSTRAINT "feed_research_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "feed_profiles"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_findings" ADD CONSTRAINT "feed_findings_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "feed_research"("id") ON DELETE CASCADE ON UPDATE CASCADE;
