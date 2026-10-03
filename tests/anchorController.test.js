const { metadataContains } = require('../src/controllers/anchorController');

describe('metadataContains (Blockfrost tx metadata search)', () => {
  const cidHash = 'a'.repeat(64);

  test('finds the cidHash nested under any label', () => {
    const metadata = [
      { label: '674', json_metadata: { msg: ['hello'] } },
      { label: '1984', json_metadata: { recordId: 'r1', anchor: { cidHash } } },
    ];
    expect(metadataContains(metadata, cidHash)).toBe(true);
  });

  test('does not match partial strings or missing values', () => {
    expect(metadataContains([{ label: '1', json_metadata: { cidHash: cidHash.slice(1) } }], cidHash)).toBe(false);
    expect(metadataContains([], cidHash)).toBe(false);
    expect(metadataContains([{ json_metadata: { x: cidHash } }], undefined)).toBe(false);
  });
});
