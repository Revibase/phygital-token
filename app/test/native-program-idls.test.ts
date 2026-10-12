import { describe, it, expect } from 'vitest';
import { nativeProgramIdls } from '../src/lib/shared/program-idls';
import { parseProgramIdl } from '../src/lib/shared/program-idl';
import system from '../src/lib/shared/program-idls/system.json';
import token from '../src/lib/shared/program-idls/token.json';
import token2022 from '../src/lib/shared/program-idls/token-2022.json';
import ata from '../src/lib/shared/program-idls/associated-token-account.json';
import { getTransferSolInstructionDataEncoder } from '@solana-program/system';
import { getTransferCheckedInstructionDataEncoder, getCreateAssociatedTokenIdempotentInstructionDataEncoder } from '@solana-program/token';
import { parseRule } from 'phygital-token-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
const hex = (data: ArrayLike<number>) => Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
describe('official native program IDLs', () => {
 for (const [label,idl] of Object.entries({system,token,token2022,ata})) {
  it(`parses the actual ${label} IDL`, async () => {
   const parsed = await parseProgramIdl(JSON.stringify(idl));
   expect(parsed.address).toBe(idl.program.publicKey);
   expect(parsed.instructions).toHaveLength(idl.program.instructions.length);
   for(const ix of parsed.instructions) expect(()=>parseRule({selector:ix.selector})).not.toThrow();
  });
 }
 it('matches System transfer encoding and names both accounts', async () => {
  const p=await parseProgramIdl(JSON.stringify(system));const ix=p.instructions.find(i=>i.selector==='02000000')!;
  expect(ix.accounts).toEqual(['Source','Destination']);
  const amount=ix.args.find(a=>a.name==='Amount')!;expect(amount).toMatchObject({offset:4,type:'u64'});
  const data=getTransferSolInstructionDataEncoder().encode({amount:123n});expect(hex(data).startsWith(ix.selector)).toBe(true);
  expect(new DataView(Uint8Array.from(data).buffer).getBigUint64(amount.offset!,true)).toBe(123n);
 });
 for(const [label,idl] of Object.entries({token,token2022}))it(`matches ${label} checked transfer encoding`,async()=>{
  const p=await parseProgramIdl(JSON.stringify(idl));const ix=p.instructions.find(i=>i.selector==='0c')!;
  expect(ix.accounts).toEqual(['Source','Mint','Destination','Authority']);
  expect(ix.args).toEqual([{name:'Amount',type:'u64',offset:1},{name:'Decimals',type:'u8',offset:9}]);
  const data=getTransferCheckedInstructionDataEncoder().encode({amount:123n,decimals:6});expect(hex(data).startsWith(ix.selector)).toBe(true);
  expect(new DataView(Uint8Array.from(data).buffer).getBigUint64(1,true)).toBe(123n);expect(data[9]).toBe(6);
 });
 it('matches ATA idempotent creation and its account positions',async()=>{
  const p=await parseProgramIdl(JSON.stringify(ata));const ix=p.instructions.find(i=>i.selector==='01')!;
  expect(ix.accounts).toEqual(['Funder','Associated Token Account','Wallet','Mint','System Program','Token Program']);expect(ix.args).toEqual([]);
  expect(hex(getCreateAssociatedTokenIdempotentInstructionDataEncoder().encode({}))).toBe(ix.selector);
 });
});

// Parsing the bundled schemas is shared across editor mounts.
it('reuses the parsed native IDL cache', async () => {
 expect(await nativeProgramIdls()).toBe(await nativeProgramIdls());
});

it('ships exactly the parsed snapshots (UPDATE_NATIVE_IDLS=1 regenerates native.json)', async () => {
 const file = new URL('../src/lib/shared/program-idls/native.json', import.meta.url);
 const parsed = Object.fromEntries(await Promise.all([system, token, token2022, ata].map(async (idl) => {
  const p = await parseProgramIdl(JSON.stringify(idl));
  return [p.address, p] as const;
 })));
 if (process.env.UPDATE_NATIVE_IDLS) writeFileSync(file, JSON.stringify(parsed) + '\n');
 expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(parsed);
 expect(await nativeProgramIdls()).toEqual(parsed);
});
