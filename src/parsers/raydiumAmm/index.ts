import * as bs58 from "bs58";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { SolanaParser } from "shyft-parser-v1";
import { RaydiumAmmParser } from "./parsers/raydium-amm-parser";
import { LogsParser } from "./parsers/logs-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import { transactionEventParser } from "./utils/transaction-event-parser";

const RAYDIUM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const TXN_FORMATTER = new TransactionFormatter();

const RAYDIUM_PUBLIC_KEY = RaydiumAmmParser.PROGRAM_ID;
const LOGS_PARSER = new LogsParser();
const IX_PARSER = new SolanaParser([]);
function decodeRaydiumTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;

  const parsedIxs = IX_PARSER.parseTransactionWithInnerInstructions(tx);

  const programIxs = parsedIxs.filter((ix) =>
    ix.programId.equals(RAYDIUM_PUBLIC_KEY),
  );

  if (programIxs.length === 0) return;
  const LogsEvent = LOGS_PARSER.parse(parsedIxs, tx.meta.logMessages);
  const result = { instructions: parsedIxs, events: LogsEvent };
  bnLayoutFormatter(result);
  return result;
}


export async function parseRaydiumAmmTransaction(tx: any) {
  const txn = TXN_FORMATTER.formTransactionFromJson(
    tx,
    Date.now(),
  );
  const parsedTxn = decodeRaydiumTxn(txn);

  if (!parsedTxn) return;

  const eventParser = transactionEventParser(txn,parsedTxn)

  console.log(
     new Date(),
     ":",
     `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
     JSON.stringify(parsedTxn, null, 2) + "\n",
    eventParser,
  );
}
