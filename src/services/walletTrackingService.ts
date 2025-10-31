/**
 * Wallet Tracking Service
 * Tracks wallet-token pairs from buy/sell events
 * Separate from token info extraction module
 * 
 * Tracks:
 * - First Buy Timestamp & Amount
 * - First Sell Timestamp & Amount
 */

import { dbService } from '../database';

export class WalletTrackingService {
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';

  /**
   * Track wallet-token pair from buy/sell event
   * Extracts the non-SOL token from the transaction and records first buy/sell
   */
  async trackWalletToken(
    walletAddress: string,
    mintFrom: string,
    mintTo: string,
    inAmount: string,
    outAmount: string,
    transactionType: string
  ): Promise<void> {
    try {
      const txType = transactionType.toUpperCase();

      // Validate transaction type
      if (txType !== 'BUY' && txType !== 'SELL') {
        console.log(`⚠️ Wallet tracking skipped - not a buy/sell transaction: ${transactionType}`);
        return;
      }

      // Extract the token (non-SOL) from the transaction
      let tokenAddress: string | null = null;
      let amount: string;

      if (txType === 'BUY') {
        // For BUY: mintTo is the token we're buying (should not be SOL)
        if (mintTo && mintTo !== this.SOL_MINT) {
          tokenAddress = mintTo;
          amount = inAmount; // Amount spent to buy (e.g., SOL amount)
        }
      } else if (txType === 'SELL') {
        // For SELL: mintFrom is the token we're selling (should not be SOL)
        if (mintFrom && mintFrom !== this.SOL_MINT) {
          tokenAddress = mintFrom;
          amount = outAmount; // Amount received from sell (e.g., SOL amount)
        }
      }

      // If no valid token found, skip
      if (!tokenAddress) {
        console.log(`⚠️ No valid token found to track (mintFrom: ${mintFrom?.substring(0, 8)}, mintTo: ${mintTo?.substring(0, 8)})`);
        return;
      }

      // Validate wallet address
      if (!walletAddress || walletAddress.length === 0) {
        console.log(`⚠️ Invalid wallet address for tracking`);
        return;
      }

      // Validate amount
      if (!amount) {
        console.log(`⚠️ No amount found for tracking`);
        return;
      }

      // Save wallet-token pair to database
      console.log(`👛 Tracking wallet-token pair:`);
      console.log(`   Wallet: ${walletAddress.substring(0, 8)}...`);
      console.log(`   Token: ${tokenAddress.substring(0, 8)}...`);
      console.log(`   Type: ${txType}`);
      console.log(`   Amount: ${amount}`);

      await dbService.saveWalletTokenPair(walletAddress, tokenAddress, txType as 'BUY' | 'SELL', amount);

    } catch (error: any) {
      console.error(`❌ Error tracking wallet-token pair:`, error.message);
    }
  }

  /**
   * Get all tokens traded by a wallet
   */
  async getWalletTokens(walletAddress: string): Promise<any[]> {
    try {
      return await dbService.getWalletTokens(walletAddress);
    } catch (error: any) {
      console.error(`❌ Error fetching wallet tokens:`, error.message);
      return [];
    }
  }

  /**
   * Get all wallets that traded a specific token
   */
  async getTokenWallets(tokenAddress: string, limit: number = 50): Promise<any[]> {
    try {
      return await dbService.getTokenWallets(tokenAddress, limit);
    } catch (error: any) {
      console.error(`❌ Error fetching token wallets:`, error.message);
      return [];
    }
  }

  /**
   * Get all wallet-token pairs with pagination
   */
  async getAllWalletTokenPairs(limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      return await dbService.getWalletTokenPairs(limit, offset);
    } catch (error: any) {
      console.error(`❌ Error fetching wallet-token pairs:`, error.message);
      return [];
    }
  }
}

// Export singleton instance
export const walletTrackingService = new WalletTrackingService();

