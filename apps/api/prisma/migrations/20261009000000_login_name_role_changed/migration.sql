-- Phase 3: a Login Name assignment can now also end because the holder's role stopped being eligible.
-- Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "login_name_end_reason" ADD VALUE IF NOT EXISTS 'ROLE_CHANGED';
