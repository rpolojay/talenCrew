// Estado de la integración de reservas de una empresa
// (leadflow_companies.bookingIntegration.status). La conexión por empresa con
// Cal.com / Calendly todavía no existe: este módulo solo define los estados y
// la pregunta que hace el resto del código — ¿es seguro automatizar mensajes
// que empujan al lead a reservar?
//
// Solo VERIFIED responde que sí. Tener un bookingLink (aunque sea una URL de
// Cal.com o Calendly válida) NO significa que la integración funcione: sin un
// webhook verificado LeadFlow no se entera de la reserva y seguiría mandando
// recordatorios a quien ya reservó. Una empresa sin el campo, o con un valor
// desconocido, falla cerrado.

const BOOKING_INTEGRATION_STATUS = {
  NOT_CONNECTED: "NOT_CONNECTED",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  VERIFIED: "VERIFIED",
  DEGRADED: "DEGRADED",
  DISCONNECTED: "DISCONNECTED",
};

const VALID_STATUSES = Object.values(BOOKING_INTEGRATION_STATUS);

// Estado tal como está guardado, o null si falta o no es uno de los
// conocidos (solo para registrar el motivo de un bloqueo).
function bookingIntegrationStatus(company) {
  const status = company?.bookingIntegration?.status;
  return VALID_STATUSES.includes(status) ? status : null;
}

function isBookingAutomationHealthy(company) {
  return bookingIntegrationStatus(company) === BOOKING_INTEGRATION_STATUS.VERIFIED;
}

module.exports = { BOOKING_INTEGRATION_STATUS, bookingIntegrationStatus, isBookingAutomationHealthy };
