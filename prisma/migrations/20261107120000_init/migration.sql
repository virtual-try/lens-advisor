-- PostgreSQL commits each statement on its own unless this script opens a transaction.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketFormat" AS ENUM ('PDF', 'CSV', 'BOTH');

-- CreateEnum
CREATE TYPE "OptionKind" AS ENUM ('MATERIAL', 'TINT_TYPE', 'COLOR');

-- CreateEnum
CREATE TYPE "RxType" AS ENUM ('SINGLE_VISION', 'PROGRESSIVE', 'READING', 'NON_PRESCRIPTION');

-- CreateEnum
CREATE TYPE "RxSource" AS ENUM ('MANUAL', 'UPLOAD');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shopId" TEXT NOT NULL,
    "labEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticketFormat" "TicketFormat" NOT NULL DEFAULT 'PDF',
    "storeRxInOrder" BOOLEAN NOT NULL DEFAULT false,
    "rxUploadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "manualRxEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "LensGroup" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "LensGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lens" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rxTypes" "RxType"[],
    "sphMin" INTEGER NOT NULL,
    "sphMax" INTEGER NOT NULL,
    "cylMin" INTEGER NOT NULL,
    "cylMax" INTEGER NOT NULL,
    "addMin" INTEGER,
    "addMax" INTEGER,
    "labCodeTemplate" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Lens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionGroup" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "OptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionValue" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "optionGroupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceDeltaMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "tokenKey" TEXT,
    "tokenValue" TEXT,
    "overrideCode" TEXT,
    "swatch" TEXT,
    "shopifyVariantId" TEXT,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "OptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "rxType" "RxType" NOT NULL,
    "source" "RxSource" NOT NULL,
    "cipher" TEXT NOT NULL,
    "uploadKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "lensId" TEXT NOT NULL,
    "optionValueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frameTitle" TEXT NOT NULL,
    "frameSku" TEXT,
    "rxOutOfLimits" BOOLEAN NOT NULL DEFAULT false,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "ticketKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopifyRequestId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "LensGroup_shopId_id_key" ON "LensGroup"("shopId", "id");

-- CreateIndex
CREATE INDEX "Lens_groupId_idx" ON "Lens"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Lens_shopId_id_key" ON "Lens"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OptionGroup_shopId_id_key" ON "OptionGroup"("shopId", "id");

-- CreateIndex
CREATE INDEX "OptionValue_optionGroupId_idx" ON "OptionValue"("optionGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionValue_shopId_id_key" ON "OptionValue"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_shopId_id_key" ON "AddOn"("shopId", "id");

-- CreateIndex
CREATE INDEX "Prescription_orderId_idx" ON "Prescription"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_shopId_id_key" ON "Prescription"("shopId", "id");

-- CreateIndex
CREATE INDEX "LabOrder_lensId_idx" ON "LabOrder"("lensId");

-- CreateIndex
CREATE INDEX "LabOrder_prescriptionId_idx" ON "LabOrder"("prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_shopId_shopifyOrderId_bundleId_key" ON "LabOrder"("shopId", "shopifyOrderId", "bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRequest_shopifyRequestId_key" ON "ComplianceRequest"("shopifyRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRequest_shopId_id_key" ON "ComplianceRequest"("shopId", "id");

-- AddForeignKey
ALTER TABLE "ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensGroup" ADD CONSTRAINT "LensGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lens" ADD CONSTRAINT "Lens_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lens" ADD CONSTRAINT "Lens_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LensGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionValue" ADD CONSTRAINT "OptionValue_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionValue" ADD CONSTRAINT "OptionValue_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_lensId_fkey" FOREIGN KEY ("lensId") REFERENCES "Lens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRequest" ADD CONSTRAINT "ComplianceRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
