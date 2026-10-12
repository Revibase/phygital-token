import {describe,it,expect} from 'vitest';
import {argumentUnit, restrictionAmount, displayRestrictionAmount } from '../src/lib/shared/action-presentation';
import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_ID } from '../src/lib/shared/programs';
describe('restriction amount presentation',()=>{
 it('normalizes known SOL units without floating point rounding',()=>{
  expect(argumentUnit(SYSTEM_ID,'Lamports','u64')).toEqual({symbol:'SOL',decimals:9});
  expect(argumentUnit(SYSTEM_ID,'Amount','u64')).toEqual({symbol:'SOL',decimals:9});
  expect(restrictionAmount('0.000000001',9)).toBe('1');
  expect(displayRestrictionAmount('1234567891',9)).toBe('1.234567891');
  expect(restrictionAmount('0',9)).toBe('0');
 });
 it('does not guess decimals for arbitrary IDL fields',()=>{
  expect(argumentUnit('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','Amount','u64',{symbol:'USDC',decimals:6})).toEqual({symbol:'USDC',decimals:6});
  expect(restrictionAmount('1.25',6)).toBe('1250000');
  expect(argumentUnit('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','Amount','u64')).toBeNull();
  expect(argumentUnit('CustomProgram','Amount','u64')).toBeNull();
  expect(argumentUnit(SYSTEM_ID,'Space','u64')).toBeNull();
  expect(()=>restrictionAmount('0.0000000001',9)).toThrow();
 });
});
