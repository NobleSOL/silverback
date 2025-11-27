-- Add protocol_fee column to anchor_swaps table
-- This tracks the 0.05% protocol fee collected by Silverback on each swap

ALTER TABLE anchor_swaps
ADD COLUMN IF NOT EXISTS protocol_fee VARCHAR(255) DEFAULT '0';

COMMENT ON COLUMN anchor_swaps.protocol_fee IS 'Protocol fee (0.05%) collected by Silverback from each swap';
