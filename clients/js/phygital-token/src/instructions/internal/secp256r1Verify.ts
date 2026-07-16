import {
  combineCodec,
  createDecoder,
  createEncoder,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU8Decoder,
  getU8Encoder,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
  type Instruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { SECP256R1_PROGRAM_ADDRESS } from "../../utils/consts.js";

const COMPRESSED_PUBKEY_SERIALIZED_SIZE = 33;
const SIGNATURE_SERIALIZED_SIZE = 64;
const SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;
const SIGNATURE_OFFSETS_START = 2;

/** One secp256r1 signature slot in a combined verify instruction. */
export type Secp256r1VerifyEntry = {
  publicKey: ReadonlyUint8Array;
  signature: ReadonlyUint8Array;
  message: ReadonlyUint8Array;
};

export type Secp256r1VerifyInstruction<
  TProgram extends string = typeof SECP256R1_PROGRAM_ADDRESS,
> = Instruction<TProgram> &
  InstructionWithData<Uint8Array<ArrayBuffer>> &
  InstructionWithAccounts<[]>;

export type Secp256r1SignatureOffsetsDataArgs = {
  signatureOffset: number;
  signatureInstructionIndex: number;
  publicKeyOffset: number;
  publicKeyInstructionIndex: number;
  messageDataOffset: number;
  messageDataSize: number;
  messageInstructionIndex: number;
};

export type Secp256r1VerifyInstructionData = {
  numSignatures: number;
  padding: number;
  offsets: Secp256r1SignatureOffsetsDataArgs[];
  payload: Secp256r1VerifyEntry[];
};

export type Secp256r1VerifyInstructionDataArgs = Secp256r1VerifyInstructionData;

function getSecp256r1SignatureOffsetsDataEncoder(): Encoder<Secp256r1SignatureOffsetsDataArgs> {
  return getStructEncoder([
    ["signatureOffset", getU16Encoder()],
    ["signatureInstructionIndex", getU16Encoder()],
    ["publicKeyOffset", getU16Encoder()],
    ["publicKeyInstructionIndex", getU16Encoder()],
    ["messageDataOffset", getU16Encoder()],
    ["messageDataSize", getU16Encoder()],
    ["messageInstructionIndex", getU16Encoder()],
  ]);
}

function getSecp256r1SignatureOffsetsDataDecoder(): Decoder<Secp256r1SignatureOffsetsDataArgs> {
  return getStructDecoder([
    ["signatureOffset", getU16Decoder()],
    ["signatureInstructionIndex", getU16Decoder()],
    ["publicKeyOffset", getU16Decoder()],
    ["publicKeyInstructionIndex", getU16Decoder()],
    ["messageDataOffset", getU16Decoder()],
    ["messageDataSize", getU16Decoder()],
    ["messageInstructionIndex", getU16Decoder()],
  ]);
}

function getSecp256r1VerifyInstructionDataEncoder(): Encoder<Secp256r1VerifyInstructionDataArgs> {
  return createEncoder({
    getSizeFromValue: (value: Secp256r1VerifyInstructionData) => {
      const offsetSize =
        SIGNATURE_OFFSETS_SERIALIZED_SIZE * value.offsets.length;
      const payloadSize = value.payload.reduce((sum, entry) => {
        return (
          sum +
          COMPRESSED_PUBKEY_SERIALIZED_SIZE +
          SIGNATURE_SERIALIZED_SIZE +
          entry.message.length
        );
      }, 0);
      return 2 + offsetSize + payloadSize;
    },
    write: (value: Secp256r1VerifyInstructionData, bytes, offset = 0) => {
      offset = getU8Encoder().write(value.numSignatures, bytes, offset);
      offset = getU8Encoder().write(value.padding, bytes, offset);

      const offsetEncoder = getSecp256r1SignatureOffsetsDataEncoder();
      for (const offsetEntry of value.offsets) {
        offset = offsetEncoder.write(offsetEntry, bytes, offset);
      }

      for (const entry of value.payload) {
        offset = fixEncoderSize(
          getBytesEncoder(),
          COMPRESSED_PUBKEY_SERIALIZED_SIZE,
        ).write(entry.publicKey, bytes, offset);

        offset = fixEncoderSize(
          getBytesEncoder(),
          SIGNATURE_SERIALIZED_SIZE,
        ).write(entry.signature, bytes, offset);

        offset = getBytesEncoder().write(entry.message, bytes, offset);
      }

      return offset;
    },
  });
}

function getSecp256r1VerifyInstructionDataDecoder(): Decoder<Secp256r1VerifyInstructionData> {
  return createDecoder({
    read: (bytes, offset = 0) => {
      const numSignatures = getU8Decoder().decode(bytes, offset);
      offset += 1;

      const padding = getU8Decoder().decode(bytes, offset);
      offset += 1;

      const offsets: Secp256r1SignatureOffsetsDataArgs[] = [];
      const offsetDecoder = getSecp256r1SignatureOffsetsDataDecoder();
      for (let i = 0; i < numSignatures; i += 1) {
        offsets.push(offsetDecoder.decode(bytes, offset));
        offset += SIGNATURE_OFFSETS_SERIALIZED_SIZE;
      }

      const payload: Secp256r1VerifyEntry[] = [];
      for (let i = 0; i < numSignatures; i += 1) {
        const publicKey = fixDecoderSize(
          getBytesDecoder(),
          COMPRESSED_PUBKEY_SERIALIZED_SIZE,
        ).decode(bytes, offset);
        offset += COMPRESSED_PUBKEY_SERIALIZED_SIZE;

        const signature = fixDecoderSize(
          getBytesDecoder(),
          SIGNATURE_SERIALIZED_SIZE,
        ).decode(bytes, offset);
        offset += SIGNATURE_SERIALIZED_SIZE;

        const messageSize = offsets[i].messageDataSize;
        const message = fixDecoderSize(getBytesDecoder(), messageSize).decode(
          bytes,
          offset,
        );
        offset += messageSize;

        payload.push({ publicKey, signature, message });
      }

      return [
        {
          numSignatures,
          padding,
          offsets,
          payload,
        },
        offset,
      ];
    },
  });
}

export function getSecp256r1VerifyInstructionDataCodec(): Codec<
  Secp256r1VerifyInstructionDataArgs,
  Secp256r1VerifyInstructionData
> {
  return combineCodec(
    getSecp256r1VerifyInstructionDataEncoder(),
    getSecp256r1VerifyInstructionDataDecoder(),
  );
}

export function getSecp256r1VerifyInstruction<
  TProgramAddress extends Address = typeof SECP256R1_PROGRAM_ADDRESS,
>(
  entries: Secp256r1VerifyEntry[],
  config?: { programAddress?: TProgramAddress },
): Secp256r1VerifyInstruction<TProgramAddress> {
  const numSignatures = entries.length;
  let currentOffset =
    SIGNATURE_OFFSETS_START + numSignatures * SIGNATURE_OFFSETS_SERIALIZED_SIZE;
  const offsets: Secp256r1SignatureOffsetsDataArgs[] = [];

  for (let i = 0; i < numSignatures; i += 1) {
    const { message } = entries[i];
    const publicKeyOffset = currentOffset;
    const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
    const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;
    offsets.push({
      publicKeyOffset,
      publicKeyInstructionIndex: 0xffff,
      signatureOffset,
      signatureInstructionIndex: 0xffff,
      messageDataOffset,
      messageDataSize: message.length,
      messageInstructionIndex: 0xffff,
    });
    currentOffset +=
      COMPRESSED_PUBKEY_SERIALIZED_SIZE +
      SIGNATURE_SERIALIZED_SIZE +
      message.length;
  }

  const programAddress = config?.programAddress ?? SECP256R1_PROGRAM_ADDRESS;
  const args = {
    numSignatures,
    padding: 0,
    offsets,
    payload: entries,
  };

  return {
    accounts: [],
    programAddress,
    data: getSecp256r1VerifyInstructionDataEncoder().encode(
      args as Secp256r1VerifyInstructionDataArgs,
    ),
  } as Secp256r1VerifyInstruction<TProgramAddress>;
}
