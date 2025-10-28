require("dotenv").config();
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import * as bs58 from "bs58";

import { parseTransaction } from "./parsers/parseFilter";

const MAX_RETRY_WITH_LAST_SLOT = 30;
const RETRY_DELAY_MS = 1000;
// const ADDRESS_TO_STREAM_FROM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const ADDRESS_TO_STREAM_FROM = [ 
  "3Ax31Gv8W6TR933oXLfB1iKHhtDg4DoHyLiScs1iJQwj",
  "1NkY29TLbZoSpbxudtfHL7xaA3pBp5nCRy8VPEUH1j3"
] ;

type StreamResult = {
  lastSlot?: string;
  hasRcvdMSg: boolean;
};


async function handleStream(
  client: Client,
  args: SubscribeRequest,
   lastSlot?: string
): Promise<StreamResult> {
  const stream = await client.subscribe();
  let hasRcvdMSg = false;
  let currentSlot = lastSlot;

  return new Promise( (resolve, reject) => {
    stream.on("data", (data) => {
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
        console.log("Parsed transaction:",  result);
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

async function subscribeCommand(client: Client, args: SubscribeRequest) {
  let lastSlot: string | undefined;
  let retryCount = 0;

  while (true) {
    try {
      if (args.fromSlot) {
        console.log("Starting stream from slot", args.fromSlot);
      }

      const result = await handleStream(client, args, lastSlot);
      lastSlot = result.lastSlot;
      if (result.hasRcvdMSg) retryCount = 0;
    } catch (err: any) {
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
}


if (!process.env.GRPC_URL || !process.env.X_TOKEN) {
  console.error("ERROR: Missing environment variables!");
  console.error("Please update your .env file with valid GRPC_URL and X_TOKEN values");
  process.exit(1);
}

if (process.env.GRPC_URL === "your_grpc_url_here" || process.env.X_TOKEN === "your_token_here") {
  console.error("ERROR: Please replace placeholder values in .env file with actual credentials");
  console.error("Current GRPC_URL:", process.env.GRPC_URL);
  process.exit(1);
}

const client = new Client(process.env.GRPC_URL, process.env.X_TOKEN, {
  "grpc.keepalive_permit_without_calls": 1,
  "grpc.keepalive_time_ms": 10000,
  "grpc.keepalive_timeout_ms": 1000,
  "grpc.default_compression_algorithm": 2,
});

const req: SubscribeRequest = {
  accounts: {},
  slots: {},
  transactions: {
    targetWallet: {
      vote: false,
      failed: false,
      accountInclude: ADDRESS_TO_STREAM_FROM,
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

subscribeCommand(client, req);