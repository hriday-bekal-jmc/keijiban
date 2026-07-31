-- Bring departments up to the same shape as branches and categories so all
-- three can be served by one managed-list router and edited in one admin
-- screen: ordered, deactivatable, uniquely named.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order INT     NOT NULL DEFAULT 0;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;
