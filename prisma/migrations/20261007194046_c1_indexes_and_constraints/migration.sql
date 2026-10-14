-- DropIndex
DROP INDEX "PaymentIntent_uniqueCode_status_key";

-- DropIndex
DROP INDEX "Session_userId_idx";

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "expiredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PaymentIntent_userId_idx" ON "PaymentIntent"("userId");

-- CreateIndex
CREATE INDEX "PaymentLog_paymentId_createdAt_idx" ON "PaymentLog"("paymentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Session_userId_createdAt_idx" ON "Session"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WaitlistEntry_priorityScore_joinedAt_idx" ON "WaitlistEntry"("priorityScore" DESC, "joinedAt" ASC);

-- ==============================================================================
-- Custom PostgreSQL Partial Indexes & Invariant CHECK Constraints (Gate C1)
-- ==============================================================================

-- 1. Partial Unique Index: Exactly one active PENDING intent per uniqueCode (1-999)
CREATE UNIQUE INDEX "PaymentIntent_uniqueCode_pending_key" 
ON "PaymentIntent" ("uniqueCode") 
WHERE status = 'PENDING';

-- 2. Range CHECK Constraint: 1 <= uniqueCode <= 999
ALTER TABLE "PaymentIntent" 
  ADD CONSTRAINT "check_payment_intent_unique_code_range" 
  CHECK ("uniqueCode" >= 1 AND "uniqueCode" <= 999);

-- 3. Exact Formula CHECK Constraint: totalAmount = 299000 + uniqueCode
ALTER TABLE "PaymentIntent" 
  ADD CONSTRAINT "check_payment_intent_total_amount_calc" 
  CHECK ("totalAmount" = 299000 + "uniqueCode");

-- 4. Active OTP Point-Lookup Partial Index
CREATE INDEX "OTPVerification_phone_active_idx" 
ON "OTPVerification" ("phone", "createdAt" DESC) 
WHERE verified = false;

-- 5. OTP Retention Maintenance Indexes (for 24h unverified & 30d verified cleanup)
CREATE INDEX "OTPVerification_retention_unverified_idx" 
ON "OTPVerification" ("createdAt") 
WHERE verified = false;

CREATE INDEX "OTPVerification_retention_verified_idx" 
ON "OTPVerification" ("createdAt") 
WHERE verified = true;

-- 6. Payment Confirmation Unique Guard: Exactly one CONFIRMED log per paymentId
CREATE UNIQUE INDEX "PaymentLog_paymentId_confirmed_key" 
ON "PaymentLog" ("paymentId") 
WHERE action = 'CONFIRMED';
