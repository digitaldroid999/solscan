require("dotenv").config();
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import * as bs58 from "bs58";
import { parseTransaction } from "../parsers/parseFilter";
import { dbService } from "../database";

const MAX_RETRY_WITH_LAST_SLOT = 30;
const RETRY_DELAY_MS = 1000;

type StreamResult = {
  lastSlot?: string;
  hasRcvdMSg: boolean;
};

class TransactionTracker {
  private client: Client | null = null;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private addresses: string[] = [];
  private currentStream: any = null;

  constructor() {
    // Initialize with empty addresses
  }

  /**
   * Initialize the tracker with GRPC client
   */
  initialize() {
    if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
      throw new Error("Missing GRPC_URL or X_TOKEN environment variables");
    }

    this.client = new Client(process.env.GRPC_URL, process.env.X_TOKEN, {
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.keepalive_time_ms": 10000,
      "grpc.keepalive_timeout_ms": 1000,
      "grpc.default_compression_algorithm": 2,
    });

    console.log("✅ Tracker initialized");
  }

  /**
   * Set addresses to track (from web interface inputs)
   */
  setAddresses(addresses: string[]) {
    this.addresses = addresses.filter(addr => addr.trim().length > 0);
    console.log('\n' + '='.repeat(60));
    console.log('📍 ADDRESSES SET FROM WEB INTERFACE:');
    console.log('='.repeat(60));
    this.addresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr}`);
    });
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Get current addresses
   */
  getAddresses(): string[] {
    return [...this.addresses];
  }

  /**
   * Check if tracker is running
   */
  isTrackerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Handle the stream
   */
  private async handleStream(
    args: SubscribeRequest,
    lastSlot?: string
  ): Promise<StreamResult> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    const stream = await this.client.subscribe();
    this.currentStream = stream;
    let hasRcvdMSg = false;
    let currentSlot = lastSlot;

    return new Promise((resolve, reject) => {
      stream.on("data", (data) => {
        // Check if we should stop
        if (this.shouldStop) {
          stream.end();
          return;
        }

        // Update lastSlot from the data
        if (data.transaction?.slot) {
          currentSlot = data.transaction.slot.toString();
        }

        const tx = data.transaction?.transaction?.transaction;
        if (tx?.signatures?.[0]) {
          hasRcvdMSg = true;
          const sig = bs58.encode(tx.signatures[0]);
          console.log("Got tx:", sig, "slot:", currentSlot);

          // Parse transaction based on detected platform
          const result = parseTransaction(data.transaction);
          console.log("Parsed transaction:", result);

          // Save to database asynchronously (non-blocking)
          if (result) {
            dbService.saveTransaction(sig, {
              platform: result.platform,
              type: result.type,
              mint_from: result.mintFrom,
              mint_to: result.mintTo,
              in_amount: result.in_amount,
              out_amount: result.out_amount,
              feePayer: result.feePayer,
            });
          }
        }
      });

      stream.on("error", (err) => {
        stream.end();
        reject({ error: err, lastSlot: currentSlot, hasRcvdMSg });
      });

      const finalize = () => resolve({ lastSlot: currentSlot, hasRcvdMSg });
      stream.on("end", finalize);
      stream.on("close", finalize);

      stream.write(args, (err: any) => {
        if (err) reject({ error: err, lastSlot: currentSlot, hasRcvdMSg });
      });
    });
  }

  /**
   * Subscribe and handle retries
   */
  private async subscribeCommand(args: SubscribeRequest) {
    let lastSlot: string | undefined;
    let retryCount = 0;

    while (this.isRunning && !this.shouldStop) {
      try {
        if (args.fromSlot) {
          console.log("Starting stream from slot", args.fromSlot);
        }

        const result = await this.handleStream(args, lastSlot);
        lastSlot = result.lastSlot;
        if (result.hasRcvdMSg) retryCount = 0;

        // If we finished normally and should stop, break the loop
        if (this.shouldStop) {
          break;
        }
      } catch (err: any) {
        // If we should stop, break the loop
        if (this.shouldStop) {
          break;
        }

        console.error(
          `Stream error, retrying in ${RETRY_DELAY_MS / 1000} second...`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

        lastSlot = err.lastSlot;
        if (err.hasRcvdMSg) retryCount = 0;

        if (lastSlot && retryCount < MAX_RETRY_WITH_LAST_SLOT) {
          console.log(
            `#${retryCount} retrying with last slot ${lastSlot}, remaining retries ${
              MAX_RETRY_WITH_LAST_SLOT - retryCount
            }`
          );
          args.fromSlot = lastSlot;
          retryCount++;
        } else {
          console.log("Retrying from latest slot (no last slot available)");
          delete args.fromSlot;
          retryCount = 0;
          lastSlot = undefined;
        }
      }
    }

    console.log("🛑 Tracker stopped");
  }

  /**
   * Start tracking transactions
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: "Tracker is already running" };
    }

    if (this.addresses.length === 0) {
      return { success: false, message: "No addresses to track" };
    }

    if (!this.client) {
      this.initialize();
    }

    this.isRunning = true;
    this.shouldStop = false;

    console.log('\n' + '🚀 '.repeat(30));
    console.log('STARTING TRANSACTION TRACKING');
    console.log('Using addresses from web interface inputs:');
    this.addresses.forEach((addr, index) => {
      console.log(`   Input ${index + 1}: ${addr}`);
    });
    console.log('🚀 '.repeat(30) + '\n');

    const req: SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
        targetWallet: {
          vote: false,
          failed: false,
          accountInclude: this.addresses, // ← Addresses from web interface inputs!
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
    };

    // Start streaming in the background
    this.subscribeCommand(req).then(() => {
      this.isRunning = false;
    });

    return { success: true, message: "Tracker started successfully" };
  }

  /**
   * Stop tracking transactions
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: false, message: "Tracker is not running" };
    }

    this.shouldStop = true;
    
    // End current stream if exists
    if (this.currentStream) {
      try {
        this.currentStream.end();
      } catch (error) {
        console.error("Error ending stream:", error);
      }
    }

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.isRunning = false;
    return { success: true, message: "Tracker stopped successfully" };
  }
}

// Export singleton instance
export const tracker = new TransactionTracker();

