/**
 * Token Service
 * Handles fetching token creator and first buy amount using Helius and Shyft APIs
 */

interface HeliusTransaction {
  slot: number;
  transaction: {
    signatures: string[];
    message: any;
  };
  meta: any;
}

interface SolscanSwapData {
  activity_type: string;
  program_id: string;
  data: {
    account: string;
    token_1: string;
    token_2: string;
    amount_1: number;
    amount_1_str: string;
    amount_2: number;
    amount_2_str: string;
    token_decimal_1: number;
    token_decimal_2: number;
    amm_id?: string;
    owner_1?: string;
    owner_2?: string;
    [key: string]: any;
  };
}

interface SolscanTransactionData {
  tx_hash: string;
  block_id: number;
  block_time: number;
  time: string;
  fee: number;
  priority_fee: number;
  summaries: Array<{
    title: SolscanSwapData;
    body: any[];
  }>;
  transfers: any[];
  activities: any[];
}

interface SolscanTransactionResult {
  success: boolean;
  data: SolscanTransactionData[];
  metadata?: {
    tokens: {
      [key: string]: {
        token_address: string;
        token_name: string;
        token_symbol: string;
        token_icon?: string;
      };
    };
  };
}

interface TokenCreatorInfo {
  creator: string;
  devBuyAmount: string;
  devBuyAmountDecimal: number;
  devBuyUsedToken: string;
  devBuyTokenAmount: string;
  devBuyTokenAmountDecimal: number;
}

export class TokenService {
  private heliusApiKey: string;
  private solscanApiKey: string;
  private heliusUrl: string;
  private skipTokensCache: Set<string> = new Set();
  private lastSkipTokensUpdate: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private cacheInitialized: boolean = false;

  constructor() {
    this.heliusApiKey = process.env.HELIUS_API_KEY || '';
    this.solscanApiKey = process.env.SOLSCAN_API_KEY || '';
    this.heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;

    if (!this.heliusApiKey || !this.solscanApiKey) {
      console.warn('⚠️ Warning: HELIUS_API_KEY or SOLSCAN_API_KEY not set in environment variables');
    }
  }

  /**
   * Refresh the skip tokens cache from database
   */
  async refreshSkipTokensCache(): Promise<void> {
    try {
      const { dbService } = await import('../database');
      const skipTokens = await dbService.getSkipTokens();
      this.skipTokensCache = new Set(skipTokens.map(t => t.mint_address));
      this.lastSkipTokensUpdate = Date.now();
      this.cacheInitialized = true;
      console.log(`🔄 Skip tokens cache updated: ${this.skipTokensCache.size} tokens`);
      if (this.skipTokensCache.size > 0) {
        console.log(`   Skip tokens: ${Array.from(this.skipTokensCache).map(t => t.substring(0, 8)).join(', ')}...`);
      }
    } catch (error) {
      console.error('Failed to refresh skip tokens cache:', error);
      this.cacheInitialized = true; // Mark as initialized even on error to prevent infinite loops
    }
  }

  /**
   * Ensure cache is initialized and fresh
   */
  private async ensureFreshCache(): Promise<void> {
    // Initialize cache if not done yet
    if (!this.cacheInitialized) {
      await this.refreshSkipTokensCache();
      return;
    }
    
    // Refresh if cache is stale
    const now = Date.now();
    if (now - this.lastSkipTokensUpdate > this.CACHE_TTL) {
      await this.refreshSkipTokensCache();
    }
  }

  /**
   * Check if a token should be skipped
   */
  async shouldSkipToken(mintAddress: string): Promise<boolean> {
    await this.ensureFreshCache();
    const shouldSkip = this.skipTokensCache.has(mintAddress);
    if (shouldSkip) {
      console.log(`    🚫 Token ${mintAddress.substring(0, 8)}... is in skip list`);
    }
    return shouldSkip;
  }

  /**
   * Get the first 10 transactions for a token mint using Helius API
   */
  async getFirstTransactions(mintAddress: string): Promise<HeliusTransaction[]> {
    try {
      const response = await fetch(this.heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'find-first-mints',
          method: 'getTransactionsForAddress',
          params: [
            mintAddress,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
              sortOrder: 'asc', // Chronological order from the beginning
              limit: 20,
              transactionDetails: 'full',
            },
          ],
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        console.error('Helius API error:', data.error);
        return [];
      }

      return data.result?.data || [];
    } catch (error) {
      console.error('Failed to fetch first transactions from Helius:', error);
      return [];
    }
  }

  /**
   * Parse multiple transactions using Solscan API in a single call
   */
  async parseTransactions(signatures: string[]): Promise<SolscanTransactionResult | null> {
    try {
      const url = 'https://pro-api.solscan.io/v2.0/transaction/actions/multi';
      
      // Build query string with array parameters
      const params = new URLSearchParams();
      signatures.forEach(sig => params.append('tx', sig));
      
      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'token': this.solscanApiKey,
        },
      });

      const data = await response.json();
      
      if (!data.success || !data.data || data.data.length === 0) {
        console.error('Solscan API error for signatures');
        return null;
      }

      return data;
    } catch (error) {
      console.error('Failed to parse transactions with Solscan:', error);
      return null;
    }
  }

  /**
   * Parse all transactions at once and find first swap
   */
  async parseTransactionsUntilSwap(
    signatures: string[], 
    mintAddress: string
  ): Promise<SolscanTransactionResult | null> {
    if (signatures.length === 0) {
      return null;
    }

    console.log(`  Parsing ${signatures.length} transactions in a single call...`);

    // Parse all transactions at once
    const parsed = await this.parseTransactions(signatures);
    
    if (!parsed || !parsed.data || parsed.data.length === 0) {
      console.log(`    ⚠️  Failed to parse transactions`);
      return null;
    }

    console.log(`    ✅ Received ${parsed.data.length} transaction results`);

    // Find the first transaction with a swap
    for (let i = 0; i < parsed.data.length; i++) {
      const txData = parsed.data[i];
      
      // Check both title and body for swap activities
      const hasSwap = txData.summaries?.some(
        (summary: any) => {
          // Check title
          const titleHasSwap = summary.title?.activity_type === 'ACTIVITY_TOKEN_SWAP' &&
                               (summary.title?.data?.token_1 === mintAddress || 
                                summary.title?.data?.token_2 === mintAddress);
          
          // Check body array
          const bodyHasSwap = summary.body?.some((bodyItem: any) => 
            bodyItem.activity_type === 'ACTIVITY_TOKEN_SWAP' &&
            (bodyItem.data?.token_1 === mintAddress || bodyItem.data?.token_2 === mintAddress)
          );
          
          return titleHasSwap || bodyHasSwap;
        }
      );

      if (hasSwap) {
        console.log(`    ✅ Found SWAP in transaction ${i + 1} (${txData.tx_hash.substring(0, 8)}...)!`);
        // Return only the transaction with swap
        return {
          success: true,
          data: [txData],
          metadata: parsed.metadata,
        };
      }
    }

    console.log(`    ❌ No swap found in ${parsed.data.length} transactions`);
    return null;
  }

  /**
   * Extract first buy information from a parsed transaction
   */
  async extractFirstBuy(
    parsedTransaction: SolscanTransactionResult,
    mintAddress: string
  ): Promise<TokenCreatorInfo | null> {
    if (!parsedTransaction.data || parsedTransaction.data.length === 0) {
      return null;
    }

    const txData = parsedTransaction.data[0];

    // Collect all swap activities from both title and body
    const allSwapActivities: any[] = [];
    
    if (txData.summaries) {
      for (const summary of txData.summaries) {
        // Check title for swaps
        if (summary.title?.activity_type === 'ACTIVITY_TOKEN_SWAP') {
          allSwapActivities.push(summary.title);
        }
        
        // Check body array for swaps
        if (summary.body && Array.isArray(summary.body)) {
          for (const bodyItem of summary.body) {
            if (bodyItem.activity_type === 'ACTIVITY_TOKEN_SWAP') {
              allSwapActivities.push(bodyItem);
            }
          }
        }
      }
    }

    if (allSwapActivities.length === 0) {
      return null;
    }

    // Process each swap activity
    for (const swapData of allSwapActivities) {
      if (!swapData.data) continue;
      
      const data = swapData.data;
      
      // Determine which token is which (token_1 or token_2 is the mint we're looking for)
      let tokenIn: string;
      let tokenOut: string;
      let amountIn: number;
      let amountInStr: string;
      let decimalIn: number;
      let decimalOut: number;
      let swapper: string;

      // Check if token_2 is the output (buying mintAddress)
      if (data.token_2 === mintAddress) {
        tokenIn = data.token_1;
        tokenOut = data.token_2;
        amountIn = data.amount_1;
        amountInStr = data.amount_1_str;
        decimalIn = data.token_decimal_1;
        decimalOut = data.token_decimal_2;
        swapper = data.account || data.owner_1;
      }
      // Check if token_1 is the output (buying mintAddress)
      else if (data.token_1 === mintAddress) {
        tokenIn = data.token_2;
        tokenOut = data.token_1;
        amountIn = data.amount_2;
        amountInStr = data.amount_2_str;
        decimalIn = data.token_decimal_2;
        decimalOut = data.token_decimal_1;
        swapper = data.account || data.owner_1;
      } else {
        continue; // This swap doesn't involve our token
      }

      // Calculate the human-readable amount for logging
      const humanAmountIn = amountIn / Math.pow(10, decimalIn);
      const humanAmountOut = data.amount_2 === amountIn ? 
                             data.amount_1 / Math.pow(10, decimalOut) : 
                             data.amount_2 / Math.pow(10, decimalOut);

      // First buy found!
      console.log(`  🎉 Creator: ${swapper}`);
      console.log(`  💰 Dev Buy: ${humanAmountIn} for ${humanAmountOut} tokens`);
      console.log(`  📊 Raw amounts: ${amountInStr} (decimal: ${decimalIn}) -> ${data.amount_2 === amountIn ? data.amount_1_str : data.amount_2_str} (decimal: ${decimalOut})`);
      
      return {
        creator: swapper,
        devBuyAmount: amountInStr,
        devBuyAmountDecimal: decimalIn,
        devBuyUsedToken: tokenIn,
        devBuyTokenAmount: data.amount_2 === amountIn ? data.amount_1_str : data.amount_2_str,
        devBuyTokenAmountDecimal: decimalOut,
      };
    }

    return null;
  }

  /**
   * Main method to get token creator and first buy amount
   */
  async getTokenCreatorInfo(mintAddress: string): Promise<TokenCreatorInfo | null> {
    console.log(`🔍 Fetching token creator info for: ${mintAddress}`);

    // Check if this token should be skipped
    if (await this.shouldSkipToken(mintAddress)) {
      console.log(`  🚫 Token ${mintAddress.substring(0, 8)}... is in skip list - skipping analysis`);
      return null;
    }

    // Step 1: Get first 10 transactions
    const transactions = await this.getFirstTransactions(mintAddress);
    
    if (transactions.length === 0) {
      console.log('  ❌ No transactions found for this token');
      return null;
    }

    console.log(`  ✅ Found ${transactions.length} transactions`);

    // Step 2: Extract signatures
    const signatures = transactions
      .map((tx) => tx.transaction.signatures[0])
      .filter((sig) => sig);

    if (signatures.length === 0) {
      console.log('  ❌ No valid signatures found');
      return null;
    }

    // Step 3: Parse transactions one by one until we find a swap
    const parsedTransaction = await this.parseTransactionsUntilSwap(signatures, mintAddress);
    
    if (!parsedTransaction) {
      console.log('  ❌ No swap transaction found');
      return null;
    }

    // Step 4: Extract first buy info from the found swap transaction
    const creatorInfo = await this.extractFirstBuy(parsedTransaction, mintAddress);
    
    if (creatorInfo) {
      return creatorInfo;
    }

    console.log('  ❌ Could not extract buy information from swap transaction');
    return null;
  }
}

export const tokenService = new TokenService();

