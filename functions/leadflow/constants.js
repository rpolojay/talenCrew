const COLLECTIONS = {
  COMPANIES: "leadflow_companies",
  LEADS: "leadflow_leads",
  EVENTS: "leadflow_lead_events",
  HANDOFFS: "leadflow_handoffs",
  // Solo Cloud Functions (Admin SDK) — firestore.rules las deniega al
  // navegador vía la regla catch-all.
  EMAIL_QUOTA: "leadflow_email_quota",
  TRIAL_SIGNUPS: "leadflow_trial_signups",
  RATE_LIMITS: "leadflow_rate_limits",
  // Una por reserva de Cal.com (id = booking uid): idempotencia del webhook
  // e historial de reservas por lead.
  BOOKINGS: "leadflow_bookings",
  // Conexiones de calendario por empresa. Solo Cloud Functions (Admin SDK).
  BOOKING_CONNECTIONS: "leadflow_booking_connections",
  // Recibos internos de webhooks de booking. Solo Cloud Functions (Admin SDK).
  // Se usan para idempotencia y no contienen secretos ni payloads crudos.
  WEBHOOK_RECEIPTS: "leadflow_webhook_receipts",
  // Auditoría de acciones de admin sobre empresas (p. ej. aprobar el envío
  // de emails). Solo backend: firestore.rules la deniega al navegador.
  ADMIN_EVENTS: "leadflow_admin_events",
};

const ADMIN_EVENT_TYPE = {
  OUTBOUND_EMAIL_STATUS_CHANGED: "OUTBOUND_EMAIL_STATUS_CHANGED",
};

const LEAD_STATUS = {
  NEW: "NEW",
  ANALYZING: "ANALYZING",
  QUALIFIED: "QUALIFIED",
  CONTACTED: "CONTACTED",
  BOOKING_SENT: "BOOKING_SENT",
  APPOINTMENT_BOOKED: "APPOINTMENT_BOOKED",
  HUMAN_REVIEW: "HUMAN_REVIEW",
  NURTURE: "NURTURE",
  CLOSED: "CLOSED",
};

const HANDOFF_TRIGGER = {
  AI_LOW_CONFIDENCE: "AI_LOW_CONFIDENCE",
  SENSITIVE_TOPIC: "SENSITIVE_TOPIC",
  PRICE_NEGOTIATION: "PRICE_NEGOTIATION",
  CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
  BUSINESS_RULE: "BUSINESS_RULE",
};

const EVENT_TYPE = {
  STATUS_CHANGE: "STATUS_CHANGE",
  AI_ANALYSIS: "AI_ANALYSIS",
  AI_REPLY_GENERATED: "AI_REPLY_GENERATED",
  FOLLOW_UP_SENT: "FOLLOW_UP_SENT",
  HANDOFF_CREATED: "HANDOFF_CREATED",
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  MANUAL_EDIT: "MANUAL_EDIT",
  // Email automático al lead que NO salió por la política de envío
  // (./emailPolicy.js). detail: { channel, reason } — sin el contenido del email.
  EMAIL_BLOCKED: "EMAIL_BLOCKED",
  // La empresa tiene un bookingLink fuera de la allowlist de proveedores
  // (./bookingToken.js): el lead calificado no recibió link. detail: { reason, host }.
  BOOKING_LINK_REJECTED: "BOOKING_LINK_REJECTED",
  // Un follow-up que empuja a reservar no salió porque la integración de
  // reservas de la empresa no está VERIFIED (./bookingIntegration.js). El
  // follow-up no se detiene. detail: { stage, integrationStatus }.
  FOLLOWUP_BLOCKED_BOOKING_INTEGRATION: "FOLLOWUP_BLOCKED_BOOKING_INTEGRATION",
  // Mensaje del lead mientras está en revisión humana (./humanReview.js): se
  // guarda para la persona a cargo, sin IA ni respuesta automática.
  // detail: { message, handoffId, notified }.
  MESSAGE_RECEIVED_DURING_REVIEW: "MESSAGE_RECEIVED_DURING_REVIEW",
  // Una persona autorizada devolvió el lead a la automatización
  // (leadflowResumeAutomation). detail: { resolvedHandoffIds }.
  AUTOMATION_RESUMED: "AUTOMATION_RESUMED",
};

module.exports = { COLLECTIONS, LEAD_STATUS, HANDOFF_TRIGGER, EVENT_TYPE, ADMIN_EVENT_TYPE };


