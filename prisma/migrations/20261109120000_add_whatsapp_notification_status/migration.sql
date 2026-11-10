-- WhatsApp notification lifecycle for automatic (post-checkout) and
-- manual (staff) sends. Additive only; existing rows default to PENDING
-- and the existing whatsappSent flag is untouched.
ALTER TABLE "Order" ADD COLUMN "whatsappStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Order" ADD COLUMN "whatsappAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "whatsappSentAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "whatsappError" TEXT;
