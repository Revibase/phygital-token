import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
} from "@solana/signers";

export async function sendInstructions(input: {
  rpc: Rpc<SolanaRpcApi>;
  feePayer: TransactionSigner;
  instructions: Instruction[];
}): Promise<Signature> {
  const { value: latestBlockhash } = await input.rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(input.feePayer, message),
    (message) =>
      appendTransactionMessageInstructions(input.instructions, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
  );

  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({
    rpc: input.rpc,
  });
  await sendTransaction(signedTransaction, { commitment: "confirmed" });
  return getSignatureFromTransaction(signedTransaction);
}
