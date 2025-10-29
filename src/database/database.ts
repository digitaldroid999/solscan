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
}

// Export a singleton instance
export const dbService = new DatabaseService();

