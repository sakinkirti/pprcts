const CLEARLY_REUSABLE_LICENSES = new Set([
  'cc0',
  'cc-0',
  'cc-by',
  'public-domain',
  'public_domain',
  'pd',
]);

function normalizeLicense(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function isClearlyReusableLicense(value) {
  const license = normalizeLicense(value);
  return CLEARLY_REUSABLE_LICENSES.has(license)
    || license.startsWith('cc-by-4')
    || license.startsWith('cc0-1');
}

function hasReusableParsedFullText(work) {
  const hasParsedContent = Boolean(
    work?.has_content?.grobid_xml || work?.content_urls?.grobid_xml,
  );
  return hasParsedContent && isClearlyReusableLicense(work?.best_oa_location?.license);
}

module.exports = {
  hasReusableParsedFullText,
  isClearlyReusableLicense,
  normalizeLicense,
};
