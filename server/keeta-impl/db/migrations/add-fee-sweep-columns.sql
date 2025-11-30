-- Migration: Add fee sweep tracking columns
-- Run this on existing databases to add the new columns

-- Add fee_swept column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'anchor_swaps' AND column_name = 'fee_swept') THEN
        ALTER TABLE anchor_swaps ADD COLUMN fee_swept BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add fee_swept_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'anchor_swaps' AND column_name = 'fee_swept_at') THEN
        ALTER TABLE anchor_swaps ADD COLUMN fee_swept_at TIMESTAMP;
    END IF;
END $$;

-- Verify columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'anchor_swaps'
  AND column_name IN ('fee_swept', 'fee_swept_at');
