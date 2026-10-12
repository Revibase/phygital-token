import { describe, it, expect } from 'vitest';
import { parseProgramIdl } from '../src/lib/shared/program-idl';
const address = 'So11111111111111111111111111111111111111112';
const idl = { address, metadata:{name:'test_program'}, instructions:[{name:'send_tokens',discriminator:[1,2,3,4,5,6,7,8],accounts:[{name:'owner'},{name:'group',accounts:[{name:'destination'}]}],args:[{name:'amount',type:'u64'},{name:'message',type:'string'},{name:'after',type:'u8'}]}] };
describe('custom program IDL', () => {
 it('names instructions and flattens accounts without guessing variable offsets', async () => {
  const parsed = await parseProgramIdl(JSON.stringify(idl));
  expect(parsed.name).toBe('Test program');
  expect(parsed.instructions[0]).toMatchObject({name:'Send tokens',selector:'0102030405060708',accounts:['Owner','Group / Destination']});
  expect(parsed.instructions[0].args.map(a=>a.offset)).toEqual([8,16,undefined]);
 });
 it('supports legacy Anchor IDLs', async () => {
  const parsed = await parseProgramIdl(JSON.stringify({name:'test',instructions:[{name:'initialize',accounts:[],args:[]}]}), address);
  expect(parsed.instructions[0].selector).toBe('afaf6d1f0d989bed');
 });
 it('rejects mismatched addresses and invalid or duplicate selectors', async () => {
  await expect(parseProgramIdl(JSON.stringify(idl),'11111111111111111111111111111111')).rejects.toThrow('match');
  await expect(parseProgramIdl(JSON.stringify({...idl,instructions:[{...idl.instructions[0],discriminator:[]}]}))).rejects.toThrow('discriminator');
  await expect(parseProgramIdl(JSON.stringify({...idl,instructions:[...idl.instructions,...idl.instructions]}))).rejects.toThrow('Duplicate');
 });
});
