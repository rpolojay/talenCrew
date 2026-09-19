// Motor de scoring determinístico (Fase 2.3) — NO usa IA. Ajusta el
// lead_score crudo de analyzeLead.js con las reglas configurables del
// tenant (leadflow_companies.scoringRules).

function isInServiceArea(leadLocation, serviceArea) {
  if (!leadLocation || !serviceArea || !serviceArea.city) return false;
  return leadLocation.toLowerCase().includes(serviceArea.city.toLowerCase());
  // v1: match simple por nombre de ciudad. Un radio geográfico real
  // (geocoding) queda pospuesto — no hace falta para la demo.
}

function scoreLead(lead, analysis, company) {
  const rules = company.scoringRules || {};
  const weights = {
    inServiceAreaWeight: rules.inServiceAreaWeight ?? 30,
    serviceMatchWeight: rules.serviceMatchWeight ?? 20,
    urgencyWeight: rules.urgencyWeight ?? 25,
    completenessWeight: rules.completenessWeight ?? 15,
    otherWeight: rules.otherWeight ?? 10,
  };

  const inArea = isInServiceArea(lead.location, company.serviceArea);
  const serviceMatch = (company.servicesOffered || []).some((s) =>
    (lead.serviceRequested || "").toLowerCase().includes(s.toLowerCase())
  );
  const urgencyFactor = { high: 1, medium: 0.5, low: 0 }[analysis.urgency] ?? 0;
  const completeness =
    [lead.contact?.name, lead.contact?.phone || lead.contact?.email, lead.serviceRequested, lead.location]
      .filter(Boolean).length / 4;

  const breakdown = {
    inServiceArea: inArea ? weights.inServiceAreaWeight : 0,
    serviceMatch: serviceMatch ? weights.serviceMatchWeight : 0,
    urgency: Math.round(urgencyFactor * weights.urgencyWeight),
    completeness: Math.round(completeness * weights.completenessWeight),
    other: Math.round((analysis.confidence ?? 0.5) * weights.otherWeight),
  };

  const adjusted = Math.min(
    100,
    Object.values(breakdown).reduce((sum, v) => sum + v, 0)
  );

  return { raw: analysis.lead_score, adjusted, breakdown, inServiceArea: inArea };
}

module.exports = { scoreLead, isInServiceArea };
