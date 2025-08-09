-- Migration: Add verification tracking fields
-- Date: 2025-12-19
-- Description: Add fields to track verification status and proof hashes for milestones

-- Add verification tracking fields to milestones table
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS proof_hash VARCHAR(66);
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS oracle_verified BOOLEAN DEFAULT false;

-- Add verification tracking fields to oracle_data table
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS verification_result BOOLEAN;
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS proof_data TEXT;

-- Add dispute resolution tracking fields
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS panel_votes JSONB;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS auto_resolved BOOLEAN DEFAULT false;

-- Add cheque verification status tracking
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS verification_required BOOLEAN DEFAULT true;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS all_milestones_verified BOOLEAN DEFAULT false;

-- Create indexes for new verification fields
CREATE INDEX IF NOT EXISTS idx_milestones_verification_status ON milestones(verification_status);
CREATE INDEX IF NOT EXISTS idx_milestones_oracle_verified ON milestones(oracle_verified);
CREATE INDEX IF NOT EXISTS idx_oracle_data_verification_result ON oracle_data(verification_result);
CREATE INDEX IF NOT EXISTS idx_disputes_escalation_level ON disputes(escalation_level);
CREATE INDEX IF NOT EXISTS idx_cheques_verification_required ON cheques(verification_required);

-- Add comments for documentation
COMMENT ON COLUMN milestones.verification_status IS 'Status of milestone verification: pending, verified, failed, disputed';
COMMENT ON COLUMN milestones.proof_hash IS 'Hash of the proof submitted for milestone completion';
COMMENT ON COLUMN milestones.verification_timestamp IS 'Timestamp when verification was completed';
COMMENT ON COLUMN milestones.oracle_verified IS 'Whether the milestone was verified by an oracle';
COMMENT ON COLUMN oracle_data.verification_result IS 'Result of oracle verification: true for verified, false for failed';
COMMENT ON COLUMN oracle_data.verification_timestamp IS 'Timestamp when oracle verification was performed';
COMMENT ON COLUMN oracle_data.proof_data IS 'Additional proof data provided to oracle';
COMMENT ON COLUMN disputes.panel_votes IS 'JSON object containing panel member votes and decisions';
COMMENT ON COLUMN disputes.escalation_level IS 'Level of dispute escalation: 0=initial, 1=panel, 2=arbitrator';
COMMENT ON COLUMN disputes.auto_resolved IS 'Whether dispute was automatically resolved by AI/oracle';
COMMENT ON COLUMN cheques.verification_required IS 'Whether this cheque requires oracle verification for milestones';
COMMENT ON COLUMN cheques.all_milestones_verified IS 'Whether all milestones have been successfully verified';