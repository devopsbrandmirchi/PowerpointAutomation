/** Slug for synthetic filenames when the API has not returned real names yet. */
export function fileSlugFromClientId(clientId) {
  if (!clientId) return 'report';
  return String(clientId).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'report';
}

export function monthYearForFilename() {
  const d = new Date();
  return `${d.toLocaleString('en-US', { month: 'long' })}_${d.getFullYear()}`;
}

/** Fallback file list for UI when generate response has no filenames yet. */
export function buildGeneratedFiles(clientId, exportMode) {
  const slug = fileSlugFromClientId(clientId);
  const my = monthYearForFilename();
  const pptName = `${slug}_${my}_filled.pptx`;
  const files = [];
  if (exportMode === 'ppt' || exportMode === 'both') {
    files.push({ name: pptName, kind: 'pptx', label: 'PowerPoint deck' });
  }
  return files;
}
