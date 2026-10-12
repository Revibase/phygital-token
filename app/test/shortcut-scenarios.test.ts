import { describe, expect, it } from 'vitest';
import { resolveShortcuts } from '$lib/shared/shortcuts';

const context = { externalUrl: 'https://project.test', tokenId: 'So11111111111111111111111111111111111111112', collectionId: null, ownerAddress: null };
const resolve = (mode: string) => resolveShortcuts({ shortcuts: [{ label: 'App', uri: 'https://provider.test/app', revibase: { launch: mode } }] }, context);
describe('shortcut launch', () => {
 for (const mode of ['embed', 'browser']) {
  it(`opens ${mode} entries as direct browser links without session data`, () => {
   expect(resolve(mode)[0]?.href).toBe('https://provider.test/app');
  });
 }
 it('the retired wallet launch mode is dropped', () => { expect(resolve('wallet')).toEqual([]); });
});
