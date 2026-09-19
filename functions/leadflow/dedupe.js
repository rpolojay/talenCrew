// Clave de deduplicación: companyId + teléfono normalizado (preferido) o
// email en minúsculas. Sirve tanto para el throttle básico como para
// detectar "mensaje adicional del mismo lead" en capture.js.
function buildDedupeKey(companyId, contact) {
  const raw = contact.phone || contact.email;
  if (!raw) return null;

  const normalized = contact.phone
    ? String(contact.phone).replace(/[^\d+]/g, "")
    : String(contact.email).trim().toLowerCase();

  if (!normalized) return null;
  return `${companyId}:${normalized}`;
}

module.exports = { buildDedupeKey };
