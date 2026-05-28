-- DropIndex
DROP INDEX "Building_briefingId_key";

-- AlterTable
ALTER TABLE "Briefing" ADD COLUMN     "acceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "sitePlanHash" TEXT,
ADD COLUMN     "sitePlanId" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "briefingId" TEXT;

-- CreateTable
CREATE TABLE "SitePlan" (
    "id" TEXT NOT NULL,
    "terrainId" TEXT NOT NULL,
    "briefingId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "validations" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SitePlan_terrainId_idx" ON "SitePlan"("terrainId");

-- CreateIndex
CREATE INDEX "SitePlan_briefingId_idx" ON "SitePlan"("briefingId");

-- CreateIndex
CREATE INDEX "SitePlan_hash_idx" ON "SitePlan"("hash");

-- CreateIndex
CREATE INDEX "Building_briefingId_idx" ON "Building"("briefingId");

-- CreateIndex
CREATE INDEX "Building_sitePlanId_idx" ON "Building"("sitePlanId");

-- CreateIndex
CREATE INDEX "Report_briefingId_idx" ON "Report"("briefingId");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_sitePlanId_fkey" FOREIGN KEY ("sitePlanId") REFERENCES "SitePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePlan" ADD CONSTRAINT "SitePlan_terrainId_fkey" FOREIGN KEY ("terrainId") REFERENCES "Terrain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePlan" ADD CONSTRAINT "SitePlan_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
