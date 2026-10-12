import { isAddress } from '@solana/kit';
export type IdlInstruction = { name: string; selector: string; accounts: string[]; args: { name: string; type: string; offset?: number }[] };
export type ProgramIdl = { address: string; name: string; instructions: IdlInstruction[] };
const object = (v: unknown): Record<string, unknown> => {
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid IDL structure.');
 return v as Record<string, unknown>;
};
export const readableName = (v: string) => v.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const name = (v: unknown) => { if (typeof v !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(v)) throw new Error('Invalid IDL name.'); return v; };
export async function parseProgramIdl(text: string, suppliedAddress = ''): Promise<ProgramIdl> {
 if (text.length > 1_000_000) throw new Error('Choose an IDL smaller than 1 MB.');
 const idl = object(JSON.parse(text));
 if (idl.standard === 'codama') return parseCodamaIdl(idl, suppliedAddress);
 const meta = idl.metadata ? object(idl.metadata) : {};
 const embedded = idl.address ?? meta.address;
 const id = suppliedAddress.trim() || embedded;
 if (typeof id !== 'string' || !isAddress(id)) throw new Error('Enter the program address for this IDL.');
 if (embedded !== undefined && embedded !== id) throw new Error('Program address doesn’t match the IDL.');
 if (!Array.isArray(idl.instructions) || !idl.instructions.length || idl.instructions.length > 256) throw new Error('IDL must contain 1–256 instructions.');
 const instructions: IdlInstruction[] = [];
 for (const raw of idl.instructions) {
  const ix = object(raw); const ixName = name(ix.name);
  let bytes = ix.discriminator;
  if (bytes === undefined) {
   const snake = ixName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
   bytes = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`global:${snake}`))).slice(0, 8));
  }
  if (!Array.isArray(bytes) || !bytes.length || bytes.length > 32 || !bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Invalid instruction discriminator.');
  const selector = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  if (instructions.some(i => i.selector === selector || i.name === readableName(ixName))) throw new Error('Duplicate instruction name or discriminator.');
  const accounts: string[] = [];
  const flatten = (list: unknown, depth = 0, prefix = '') => {
   if (!Array.isArray(list) || depth > 8) throw new Error('Invalid instruction accounts.');
   for (const raw of list) { const a = object(raw); const label = prefix + readableName(name(a.name));
    if (a.accounts !== undefined) flatten(a.accounts, depth + 1, label + ' / '); else accounts.push(label);
    if (accounts.length > 64) throw new Error('Too many instruction accounts.');
   }
  };
  flatten(ix.accounts ?? []);
  if (!Array.isArray(ix.args ?? []) || Array.isArray(ix.args) && ix.args.length > 128) throw new Error('Invalid instruction arguments.');
  let offset: number | undefined = bytes.length;
  const sizes: Record<string, number> = { u8:1,i8:1,bool:1,u16:2,i16:2,u32:4,i32:4,f32:4,u64:8,i64:8,f64:8,u128:16,i128:16,pubkey:32,publicKey:32 };
  const args = ((ix.args ?? []) as unknown[]).map(raw => {
   const a = object(raw); const type = typeof a.type === 'string' ? a.type : 'Custom type';
   const result = { name: readableName(name(a.name)), type, offset };
   offset = offset !== undefined && sizes[type] ? offset + sizes[type] : undefined;
   return result;
  });
  instructions.push({ name: readableName(ixName), selector, accounts, args });
 }
 return { address:id, name:readableName(name(meta.name ?? idl.name)), instructions };
}

/** Read the published Codama schema directly; never infer Anchor discriminators. */
function parseCodamaIdl(idl: Record<string, unknown>, suppliedAddress: string): ProgramIdl {
 const program = object(idl.program); const id = program.publicKey;
 if (typeof id !== 'string' || !isAddress(id)) throw new Error('Invalid program address in IDL.');
 if (suppliedAddress.trim() && suppliedAddress.trim() !== id) throw new Error('Program address doesn’t match the IDL.');
 if (!Array.isArray(program.instructions) || program.instructions.length > 256) throw new Error('Invalid IDL instructions.');
 const widths: Record<string,number> = {u8:1,i8:1,u16:2,i16:2,u32:4,i32:4,u64:8,i64:8,u128:16,i128:16,f32:4,f64:8};
 const size = (raw: unknown, depth = 0): number | undefined => {
  if (depth > 8) return undefined;
  const t = object(raw);
  if (t.kind === 'numberTypeNode') return widths[String(t.format)];
  if (t.kind === 'publicKeyTypeNode') return 32;
  if (t.kind === 'fixedSizeTypeNode' && Number.isInteger(t.size) && Number(t.size) >= 0) return Number(t.size);
  if (t.kind === 'booleanTypeNode') return t.size ? size(t.size, depth+1) : 1;
  if (t.kind === 'definedTypeLinkNode') { const d = (program.definedTypes as Record<string,unknown>[] | undefined)?.find(d => d.name === t.name); return d ? size(d.type,depth+1) : undefined; }
  if (t.kind === 'structTypeNode' && Array.isArray(t.fields)) { let total = 0; for (const f of t.fields) {const n = size(object(f).type,depth+1); if(n === undefined)return; total+=n;} return total; }
  return undefined;
 };
 const instructions: IdlInstruction[] = program.instructions.map(raw => {
  const ix = object(raw); const fields = (ix.arguments ?? []) as Record<string,unknown>[];
  if (!Array.isArray(fields) || !Array.isArray(ix.accounts)) throw new Error('Invalid instruction layout.');
  const discriminators = ix.discriminators;
  if (!Array.isArray(discriminators) || !discriminators.length) throw new Error('Missing instruction discriminator.');
  const bytes: number[] = [];
  for (const raw of [...discriminators].sort((a,b)=>Number(a.offset)-Number(b.offset))) {
   const d = object(raw); const field = fields.find(f => f.name === d.name);
   if(d.kind !== 'fieldDiscriminatorNode' || d.offset !== bytes.length || !field) throw new Error('Unsupported discriminator layout.');
   const type = object(field.type); const value = object(field.defaultValue); const width = widths[String(type.format)];
   if (type.kind === 'fixedSizeTypeNode' && value.kind === 'bytesValueNode' && value.encoding === 'base16' && typeof value.data === 'string' && /^[0-9a-f]+$/i.test(value.data) && value.data.length === Number(type.size)*2) { bytes.push(...Array.from(value.data.match(/../g)!, b=>parseInt(b,16))); continue; }
   if(type.kind !== 'numberTypeNode' || type.endian !== 'le' || !width || value.kind !== 'numberValueNode' || !Number.isSafeInteger(value.number) || Number(value.number)<0) throw new Error('Unsupported discriminator encoding.');
   let number = BigInt(value.number as number); for(let i=0;i<width;i++){bytes.push(Number(number&255n));number>>=8n;} if(number)throw new Error('Discriminator is out of range.');
  }
  const selector = bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
  let offset: number | undefined = 0;
  const args: IdlInstruction['args'] = [];
  for(const field of fields){
   const type = object(field.type); const n = size(type); const at = offset;
   offset = offset !== undefined && n !== undefined ? offset+n : undefined;
   if(discriminators.some(d=>d.name===field.name)) continue;
   args.push({name:readableName(name(field.name)),type:type.kind==='numberTypeNode' && type.endian==='le' ? String(type.format) : 'Unsupported field', offset:at});
  }
  return {name:readableName(name(ix.name)),selector,accounts:(ix.accounts as unknown[]).map(a=>readableName(name(object(a).name))),args};
 });
 if(new Set(instructions.map(i=>i.selector)).size !== instructions.length) throw new Error('Duplicate instruction discriminator.');
 return {address:id,name:readableName(name(program.name)),instructions};
}
