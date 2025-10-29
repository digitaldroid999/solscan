-- PostgreSQL Schema for Solana Transaction Storage
-- Run this manually if you need to set up the database from scratch

-- Create the database (if needed)
-- CREATE DATABASE solscan;

-- Create the transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    mint_from VARCHAR(100) NOT NULL,
    mint_to VARCHAR(100) NOT NULL,
    in_amount NUMERIC(40, 0) NOT NULL,
    out_amount NUMERIC(40, 0) NOT NULL,
    fee_payer VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform ON transactions(platform);
CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_fee_payer ON transactions(fee_payer);

-- Optional: Create a view for transaction statistics
CREATE OR REPLACE VIEW transaction_stats AS
SELECT 
    platform,
    type,
    COUNT(*) as transaction_count,
    SUM(CAST(in_amount AS NUMERIC)) as total_in_amount,
    SUM(CAST(out_amount AS NUMERIC)) as total_out_amount,
    DATE(created_at) as date
FROM transactions
GROUP BY platform, type, DATE(created_at)
ORDER BY date DESC, platform, type;

