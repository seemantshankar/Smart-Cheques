-- Database schema for Smart Cheques platform

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) UNIQUE NOT NULL,
    nonce INTEGER NOT NULL DEFAULT floor(random() * 1000000),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cheques table
CREATE TABLE cheques (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    cheque_id VARCHAR NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    buyer_address VARCHAR(42) NOT NULL,
    seller_address VARCHAR(42) NOT NULL,
    total_amount NUMERIC NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, cheque_id)
);

-- Milestones table
CREATE TABLE milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cheque_id UUID NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
    milestone_index INTEGER NOT NULL,
    amount NUMERIC NOT NULL,
    description TEXT NOT NULL,
    obligation TEXT NOT NULL,
    proof TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cheque_id, milestone_index)
);

-- Disputes table
CREATE TABLE disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    dispute_id VARCHAR NOT NULL,
    cheque_id UUID NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    initiator_address VARCHAR(42) NOT NULL,
    arbitrator_address VARCHAR(42),
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    resolution_type INTEGER,
    resolution_amount NUMERIC,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, dispute_id)
);

-- Oracle data table
CREATE TABLE oracle_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    obligation_hash VARCHAR NOT NULL,
    oracle_address VARCHAR(42) NOT NULL,
    data_hash VARCHAR NOT NULL,
    reliability_score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(obligation_hash, oracle_address)
);

-- Events table for tracking contract events
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    event_name VARCHAR NOT NULL,
    transaction_hash VARCHAR NOT NULL,
    block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL,
    parameters JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chain_id, transaction_hash, log_index)
);

-- Indexes
CREATE INDEX idx_users_address ON users(address);
CREATE INDEX idx_cheques_buyer ON cheques(buyer_address);
CREATE INDEX idx_cheques_seller ON cheques(seller_address);
CREATE INDEX idx_cheques_status ON cheques(status);
CREATE INDEX idx_cheques_created_at ON cheques(created_at);
CREATE INDEX idx_milestones_completed ON milestones(is_completed);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_created_at ON disputes(created_at);
CREATE INDEX idx_oracle_data_hash ON oracle_data(obligation_hash);
CREATE INDEX idx_events_contract ON events(contract_address);
CREATE INDEX idx_events_block ON events(block_number);

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_cheques_updated_at
    BEFORE UPDATE ON cheques
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_milestones_updated_at
    BEFORE UPDATE ON milestones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_oracle_data_updated_at
    BEFORE UPDATE ON oracle_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Verification and dispute enhancements (kept in baseline to match migrations)
-- Milestone verification tracking
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS proof_hash VARCHAR(66);
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS oracle_verified BOOLEAN DEFAULT false;

-- Oracle verification metadata
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS verification_result BOOLEAN;
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE oracle_data ADD COLUMN IF NOT EXISTS proof_data TEXT;

-- Dispute resolution details
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS panel_votes JSONB;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS auto_resolved BOOLEAN DEFAULT false;

-- Cheque-level verification flags
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS verification_required BOOLEAN DEFAULT true;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS all_milestones_verified BOOLEAN DEFAULT false;

-- Indexes for new fields
CREATE INDEX IF NOT EXISTS idx_milestones_verification_status ON milestones(verification_status);
CREATE INDEX IF NOT EXISTS idx_milestones_oracle_verified ON milestones(oracle_verified);
CREATE INDEX IF NOT EXISTS idx_oracle_data_verification_result ON oracle_data(verification_result);
CREATE INDEX IF NOT EXISTS idx_disputes_escalation_level ON disputes(escalation_level);
CREATE INDEX IF NOT EXISTS idx_cheques_verification_required ON cheques(verification_required);

-- Column documentation
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