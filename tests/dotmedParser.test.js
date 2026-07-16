const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractPhotos, isStorefrontUrl } = require('../src/dotmedParser');

test('extractPhotos pulls listing photo URLs and drops /thumbs/ carousel images', () => {
  const markdown = `
    ![](https://images.dotmed.com/images/listingpics2/5/7/6/0/5760301.jpg)
    ![](https://images.dotmed.com/images/listingpics2/5/7/6/0/5760301_2.jpg)
    ![](https://images.dotmed.com/images/listingpics2/thumbs/9/9/9/9999999.jpg)
    ![](https://images.dotmed.com/images/listingpics2/5/7/6/0/5760301.jpg)
  `;
  const photos = extractPhotos(markdown);
  assert.equal(photos.length, 2, 'should dedupe and exclude /thumbs/');
  assert.ok(photos.every((p) => !p.includes('/thumbs/')));
});

test('extractPhotos returns empty array when no images present', () => {
  assert.deepEqual(extractPhotos('no images here'), []);
});

test('isStorefrontUrl recognizes webstore and profile links', () => {
  assert.ok(isStorefrontUrl('https://www.dotmed.com/webstore/74'));
  assert.ok(isStorefrontUrl('https://www.dotmed.com/virtual-trade-show/category/profiles/robert-manetta/74'));
});

test('isStorefrontUrl rejects normal listing links', () => {
  assert.ok(!isStorefrontUrl('https://www.dotmed.com/listing/ct-scanner/ge/brightspeed-8/5760301'));
});
