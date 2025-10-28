
import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import { Idl } from "@coral-xyz/anchor";
import { SolanaParser } from "shyft-parser-v2";
import { SubscribeRequestPing } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { SolanaEventParser } from "./utils/event-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import raydiumLaunchpadIdl from "./idls/raydium_launchpad.json";
import { writeFileSync } from "fs";
import { parsedTransactionOutput } from "./utils/rl-transaction-formatter";

const TXN_FORMATTER = new TransactionFormatter();
const RAYDIUM_LAUNCHPAD_PROGRAM_ID = new PublicKey(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
);
const RAYDIUM_LAUNCHPAD_IX_PARSER = new SolanaParser([]);
RAYDIUM_LAUNCHPAD_IX_PARSER.addParserFromIdl(
  RAYDIUM_LAUNCHPAD_PROGRAM_ID.toBase58(),
  raydiumLaunchpadIdl as Idl
);
const RAYDIUM_LAUNCHPAD_EVENT_PARSER = new SolanaEventParser([], console);
RAYDIUM_LAUNCHPAD_EVENT_PARSER.addParserFromIdl(
  RAYDIUM_LAUNCHPAD_PROGRAM_ID.toBase58(),
  raydiumLaunchpadIdl as Idl
);

function decodeRaydiumLaunchpad(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;

    const paredIxs = RAYDIUM_LAUNCHPAD_IX_PARSER.parseTransactionData(
        tx.transaction.message,
        tx.meta.loadedAddresses
    );

    const raydiumLaunchpadIxs = paredIxs.filter((ix) =>
        ix.programId.equals(RAYDIUM_LAUNCHPAD_PROGRAM_ID)
    );

    if (raydiumLaunchpadIxs.length === 0) return;
    const events = RAYDIUM_LAUNCHPAD_EVENT_PARSER.parseEvent(tx);
    const result = events.length > 0 ? { instructions: raydiumLaunchpadIxs, events } : { instructions: raydiumLaunchpadIxs };
    bnLayoutFormatter(result);
    return result;
}

export async function parseRaydiumLaunchPadTransaction(tx: any) {
    const txn = TXN_FORMATTER.formTransactionFromJson(
        tx,
        Date.now()
    );

    const parsedTxn = decodeRaydiumLaunchpad(txn);

    if (!parsedTxn) return;

    const rl_formatter = parsedTransactionOutput(parsedTxn, txn);

    console.log(
        new Date(),
        ":",
        `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
        JSON.stringify(rl_formatter.output, null, 2) + "\n",
        JSON.stringify(rl_formatter.transactionEvent)
    );
    console.log(
        "--------------------------------------------------------------------------------------------------"
    );
}
