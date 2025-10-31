import { Pool, PoolClient } from 'pg';

interface TransactionData {
  transaction_id: string;
  platform: string;
  type: string;
  mint_from: string;
  mint_to: string;
  in_amount: string;
  out_amount: string;
  feePayer: string;
}

interface TokenData {
  mint_address: string;
  creator?: string;
  dev_buy_amount?: string;
  dev_buy_amount_decimal?: number;
  dev_buy_used_token?: string;
  dev_buy_token_amount?: string;
  dev_buy_token_amount_decimal?: number;
  token_name?: string;
  symbol?: string;
  image?: string;
}

interface SkipToken {
  id?: number;
  mint_address: string;
  symbol?: string;
  description?: string;
  created_at?: Date;
}

class DatabaseService {
  private pool: Pool;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize connection pool with environment variables
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'solscan',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20, // Maximum number of clients in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Initialize the database (create table if not exists)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const createTableQuery = `
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

        CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_platform ON transactions(platform);
        CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
        CREATE INDEX IF NOT EXISTS idx_fee_payer ON transactions(fee_payer);

        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(100) UNIQUE NOT NULL,
          creator VARCHAR(100),
          dev_buy_amount VARCHAR(100),
          dev_buy_amount_decimal INTEGER,
          dev_buy_used_token VARCHAR(100),
          dev_buy_token_amount VARCHAR(100),
          dev_buy_token_amount_decimal INTEGER,
          token_name VARCHAR(200),
          symbol VARCHAR(50),
          image TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_mint_address ON tokens(mint_address);
        CREATE INDEX IF NOT EXISTS idx_creator ON tokens(creator);
        CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);

        CREATE TABLE IF NOT EXISTS skip_tokens (
          id SERIAL PRIMARY KEY,
          mint_address VARCHAR(100) UNIQUE NOT NULL,
          symbol VARCHAR(50),
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_skip_mint_address ON skip_tokens(mint_address);

        CREATE TABLE IF NOT EXISTS wallets (
          id SERIAL PRIMARY KEY,
          wallet_address VARCHAR(100) NOT NULL,
          token_address VARCHAR(100) NOT NULL,
          first_buy_timestamp TIMESTAMP,
          first_buy_amount VARCHAR(100),
          first_sell_timestamp TIMESTAMP,
          first_sell_amount VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(wallet_address, token_address)
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_address ON wallets(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_token_address ON wallets(token_address);
        CREATE INDEX IF NOT EXISTS idx_wallet_token ON wallets(wallet_address, token_address);
        CREATE INDEX IF NOT EXISTS idx_wallets_first_buy ON wallets(first_buy_timestamp);
        CREATE INDEX IF NOT EXISTS idx_wallets_first_sell ON wallets(first_sell_timestamp);
      `;

      await this.pool.query(createTableQuery);
      this.isInitialized = true;
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Save transaction data to PostgreSQL asynchronously
   * This function does not block the main process
   */
  async saveTransaction(
    transactionId: string,
    transactionData: Omit<TransactionData, 'transaction_id'>
  ): Promise<void> {
    // Use setImmediate to ensure this is truly async and non-blocking
    setImmediate(async () => {
      try {
        const query = `
          INSERT INTO transactions (
            transaction_id,
            platform,
            type,
            mint_from,
            mint_to,
            in_amount,
            out_amount,
            fee_payer
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (transaction_id) DO NOTHING
        `;

        const values = [
          transactionId,
          transactionData.platform,
          transactionData.type,
          transactionData.mint_from,
          transactionData.mint_to,
          transactionData.in_amount?.toString() || '0',
          transactionData.out_amount?.toString() || '0',
          transactionData.feePayer,
        ];

        await this.pool.query(query, values);
        console.log(`💾 Transaction saved to DB: ${transactionId}`);
      } catch (error: any) {
        // Only log errors that aren't duplicate key conflicts
        if (error.code !== '23505') {
          console.error(`❌ Failed to save transaction ${transactionId}:`, error.message);
        }
      }
    });
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('Database connection pool closed');
  }

  /**
   * Get pool statistics
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Get recent transactions with pagination and optional date filtering
   */
  async getTransactions(
    limit: number = 50, 
    offset: number = 0,
    fromDate?: string,
    toDate?: string
  ): Promise<TransactionData[]> {
    try {
      let query = `
        SELECT 
          transaction_id,
          platform,
          type,
          mint_from,
          mint_to,
          in_amount,
          out_amount,
          fee_payer as "feePayer",
          created_at
        FROM transactions
      `;
      
      const params: any[] = [];
      const conditions: string[] = [];
      let paramCount = 0;

      // Add date filters if provided
      if (fromDate) {
        paramCount++;
        conditions.push(`created_at >= $${paramCount}`);
        params.push(fromDate);
      }

      if (toDate) {
        paramCount++;
        // Add end of day to include the entire toDate
        conditions.push(`created_at <= $${paramCount}`);
        params.push(`${toDate} 23:59:59`);
      }

      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      // Always sort by most recent first
      query += ' ORDER BY created_at DESC';

      // Add pagination
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);

      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(offset);

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      throw error;
    }
  }

  /**
   * Get total transaction count with optional date filtering
   */
  async getTransactionCount(fromDate?: string, toDate?: string): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) as count FROM transactions';
      const params: any[] = [];
      const conditions: string[] = [];
      let paramCount = 0;

      // Add date filters if provided
      if (fromDate) {
        paramCount++;
        conditions.push(`created_at >= $${paramCount}`);
        params.push(fromDate);
      }

      if (toDate) {
        paramCount++;
        conditions.push(`created_at <= $${paramCount}`);
        params.push(`${toDate} 23:59:59`);
      }

      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const result = await this.pool.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Failed to get transaction count:', error);
      return 0;
    }
  }

  /**
   * Save token data to PostgreSQL
   */
  async saveToken(tokenData: TokenData): Promise<void> {
    try {
      const query = `
        INSERT INTO tokens (
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          token_name,
          symbol,
          image,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
        ON CONFLICT (mint_address) 
        DO UPDATE SET
          creator = COALESCE(EXCLUDED.creator, tokens.creator),
          dev_buy_amount = COALESCE(EXCLUDED.dev_buy_amount, tokens.dev_buy_amount),
          dev_buy_amount_decimal = COALESCE(EXCLUDED.dev_buy_amount_decimal, tokens.dev_buy_amount_decimal),
          dev_buy_used_token = COALESCE(EXCLUDED.dev_buy_used_token, tokens.dev_buy_used_token),
          dev_buy_token_amount = COALESCE(EXCLUDED.dev_buy_token_amount, tokens.dev_buy_token_amount),
          dev_buy_token_amount_decimal = COALESCE(EXCLUDED.dev_buy_token_amount_decimal, tokens.dev_buy_token_amount_decimal),
          token_name = COALESCE(EXCLUDED.token_name, tokens.token_name),
          symbol = COALESCE(EXCLUDED.symbol, tokens.symbol),
          image = COALESCE(EXCLUDED.image, tokens.image),
          updated_at = CURRENT_TIMESTAMP
      `;

      const values = [
        tokenData.mint_address,
        tokenData.creator || null,
        tokenData.dev_buy_amount || null,
        tokenData.dev_buy_amount_decimal || null,
        tokenData.dev_buy_used_token || null,
        tokenData.dev_buy_token_amount || null,
        tokenData.dev_buy_token_amount_decimal || null,
        tokenData.token_name || null,
        tokenData.symbol || null,
        tokenData.image || null,
      ];

      await this.pool.query(query, values);
      console.log(`💾 Token info saved to DB: ${tokenData.mint_address}`);
    } catch (error: any) {
      console.error(`❌ Failed to save token ${tokenData.mint_address}:`, error.message);
      throw error;
    }
  }

  /**
   * Get token data by mint address
   */
  async getToken(mintAddress: string): Promise<TokenData | null> {
    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          token_name,
          symbol,
          image,
          created_at,
          updated_at
        FROM tokens
        WHERE mint_address = $1
      `;

      const result = await this.pool.query(query, [mintAddress]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error(`Failed to fetch token ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Get tokens by multiple mint addresses
   */
  async getTokensByMints(mintAddresses: string[]): Promise<TokenData[]> {
    if (mintAddresses.length === 0) {
      return [];
    }

    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          token_name,
          symbol,
          image,
          created_at,
          updated_at
        FROM tokens
        WHERE mint_address = ANY($1)
      `;

      const result = await this.pool.query(query, [mintAddresses]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch tokens by mints:', error);
      return [];
    }
  }

  /**
   * Get all tokens with pagination
   */
  async getTokens(limit: number = 50, offset: number = 0): Promise<TokenData[]> {
    try {
      const query = `
        SELECT 
          mint_address,
          creator,
          dev_buy_amount,
          dev_buy_amount_decimal,
          dev_buy_used_token,
          dev_buy_token_amount,
          dev_buy_token_amount_decimal,
          created_at,
          updated_at
        FROM tokens
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await this.pool.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
      return [];
    }
  }

  /**
   * Add a token to the skip list
   */
  async addSkipToken(skipToken: SkipToken): Promise<void> {
    try {
      const query = `
        INSERT INTO skip_tokens (mint_address, symbol, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (mint_address) DO NOTHING
      `;

      const values = [
        skipToken.mint_address,
        skipToken.symbol || null,
        skipToken.description || null,
      ];

      await this.pool.query(query, values);
      console.log(`💾 Skip token added: ${skipToken.mint_address}`);
    } catch (error: any) {
      console.error(`❌ Failed to add skip token:`, error.message);
      throw error;
    }
  }

  /**
   * Remove a token from the skip list
   */
  async removeSkipToken(mintAddress: string): Promise<void> {
    try {
      const query = `DELETE FROM skip_tokens WHERE mint_address = $1`;
      await this.pool.query(query, [mintAddress]);
      console.log(`🗑️ Skip token removed: ${mintAddress}`);
    } catch (error: any) {
      console.error(`❌ Failed to remove skip token:`, error.message);
      throw error;
    }
  }

  /**
   * Get all skip tokens
   */
  async getSkipTokens(): Promise<SkipToken[]> {
    try {
      const query = `
        SELECT id, mint_address, symbol, description, created_at
        FROM skip_tokens
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch skip tokens:', error);
      return [];
    }
  }

  /**
   * Check if a token is in the skip list
   */
  async isSkipToken(mintAddress: string): Promise<boolean> {
    try {
      const query = `SELECT 1 FROM skip_tokens WHERE mint_address = $1`;
      const result = await this.pool.query(query, [mintAddress]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('Failed to check skip token:', error);
      return false;
    }
  }

  /**
   * Initialize default skip tokens (SOL, USDC, etc.)
   */
  async initializeDefaultSkipTokens(): Promise<void> {
    const defaultSkipTokens = [
      {
        mint_address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        description: 'Wrapped SOL'
      },
      {
        mint_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        description: 'USD Coin'
      },
      {
        mint_address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        symbol: 'USDT',
        description: 'Tether USD'
      }
    ];

    for (const token of defaultSkipTokens) {
      try {
        await this.addSkipToken(token);
      } catch (error) {
        // Ignore errors (likely duplicates)
      }
    }
  }

  /**
   * Save or update wallet-token pair with buy/sell tracking
   */
  async saveWalletTokenPair(
    walletAddress: string,
    tokenAddress: string,
    transactionType: 'BUY' | 'SELL',
    amount: string
  ): Promise<void> {
    // Use setImmediate to ensure this is truly async and non-blocking
    setImmediate(async () => {
      try {
        if (transactionType === 'BUY') {
          // Insert or update first buy info (only if first_buy_timestamp is NULL)
          const query = `
            INSERT INTO wallets (
              wallet_address,
              token_address,
              first_buy_timestamp,
              first_buy_amount
            ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
            ON CONFLICT (wallet_address, token_address) 
            DO UPDATE SET
              first_buy_timestamp = COALESCE(wallets.first_buy_timestamp, CURRENT_TIMESTAMP),
              first_buy_amount = COALESCE(wallets.first_buy_amount, $3)
          `;
          await this.pool.query(query, [walletAddress, tokenAddress, amount]);
          console.log(`💾 Wallet BUY tracked: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}... (Amount: ${amount})`);
        } else if (transactionType === 'SELL') {
          // Insert or update first sell info (only if first_sell_timestamp is NULL)
          const query = `
            INSERT INTO wallets (
              wallet_address,
              token_address,
              first_sell_timestamp,
              first_sell_amount
            ) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
            ON CONFLICT (wallet_address, token_address) 
            DO UPDATE SET
              first_sell_timestamp = COALESCE(wallets.first_sell_timestamp, CURRENT_TIMESTAMP),
              first_sell_amount = COALESCE(wallets.first_sell_amount, $3)
          `;
          await this.pool.query(query, [walletAddress, tokenAddress, amount]);
          console.log(`💾 Wallet SELL tracked: ${walletAddress.substring(0, 8)}... - ${tokenAddress.substring(0, 8)}... (Amount: ${amount})`);
        }
      } catch (error: any) {
        console.error(`❌ Failed to save wallet-token pair:`, error.message);
      }
    });
  }

  /**
   * Get wallet-token pairs by wallet address
   */
  async getWalletTokens(walletAddress: string): Promise<any[]> {
    try {
      const query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_sell_timestamp,
          first_sell_amount,
          created_at
        FROM wallets
        WHERE wallet_address = $1
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query, [walletAddress]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch wallet tokens:', error);
      return [];
    }
  }

  /**
   * Get wallets by token address
   */
  async getTokenWallets(tokenAddress: string, limit: number = 50): Promise<any[]> {
    try {
      const query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_sell_timestamp,
          first_sell_amount,
          created_at
        FROM wallets
        WHERE token_address = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await this.pool.query(query, [tokenAddress, limit]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch token wallets:', error);
      return [];
    }
  }

  /**
   * Get all wallet-token pairs with pagination
   */
  async getWalletTokenPairs(limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      const query = `
        SELECT 
          wallet_address,
          token_address,
          first_buy_timestamp,
          first_buy_amount,
          first_sell_timestamp,
          first_sell_amount,
          created_at
        FROM wallets
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await this.pool.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('Failed to fetch wallet-token pairs:', error);
      return [];
    }
  }
}

// Export a singleton instance
export const dbService = new DatabaseService();

