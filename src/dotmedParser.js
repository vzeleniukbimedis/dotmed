const LISTING_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Full listing title/heading' },
    brand: { type: 'string', description: 'Brand/manufacturer, empty string if not present' },
    model: { type: 'string', description: 'Model, empty string if not present' },
    category: { type: 'string', description: "The 'Type' field value, e.g. CT Scanner, Microscope, ICU/CCU" },
    condition: { type: 'string', description: 'Condition, e.g. Used - Good, New, empty string if not present' },
    price: { type: 'string', description: 'Asking price with currency exactly as shown, empty string if not listed' },
    year: { type: 'string', description: 'The equipment manufacture/model year (e.g. from a serial number or description like "2010 GE - BrightSpeed"), empty string if not found. Do NOT use the listing "Date:" field, which is just when the ad was posted, not the equipment year.' },
    warranty: { type: 'string', description: 'Warranty terms if mentioned anywhere on the page, empty string if not found' },
    description: { type: 'string', description: 'Full free-text item description' },
    isPart: { type: 'boolean', description: 'true if this listing is for a replacement part/accessory rather than a full equipment unit (look for a "Part Number" or "Part #" field)' },
    partNumber: { type: 'string', description: 'Part number, empty string if isPart is false or not found' },
    partsDescription: { type: 'string', description: 'The short parts description field shown next to Part Number, empty string if isPart is false' },
  },
  required: ['title', 'condition', 'description', 'isPart'],
};

function extractPhotos(markdown) {
  const matches = markdown.matchAll(/\]\((https:\/\/images\.dotmed\.com\/images\/listingpics2\/[^)]+)\)/g);
  const urls = [...new Set([...matches].map((m) => m[1]))];
  // "/thumbs/" images belong to the "related items" carousel, not this listing's own photos
  return urls.filter((u) => !u.includes('/thumbs/'));
}

function isStorefrontUrl(url) {
  return /\/webstore\/|\/virtual-trade-show\/category\/profiles\//.test(url);
}

module.exports = { LISTING_SCHEMA, extractPhotos, isStorefrontUrl };
