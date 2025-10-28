import * as bs58 from "bs58";
import { parseSwapTransactionOutput } from "./utils/pumpfun_formatted_txn";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { PumpFunDecoder } from "./utils/decode-parser";

const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TXN_FORMATTER = new TransactionFormatter();
const pumpFunDecoder = new PumpFunDecoder();

export async function parsePumpFunTransaction(tx: any) {
  const txn = TXN_FORMATTER.formTransactionFromJson(
    tx,
    Date.now(),
  );
  const parsedTxn = pumpFunDecoder.decodePumpFunTxn(txn);

  const parsedPumpfunTxn = parseSwapTransactionOutput(parsedTxn)
   console.log(
    new Date(),
    ":",
    `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
    JSON.stringify(parsedPumpfunTxn, null, 2) + "\n"
  );
  console.log(
    "--------------------------------------------------------------------------------------------------"
  );
}

