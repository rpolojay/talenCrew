"use strict";

/*
 * Adaptador interno de Cal.com.
 *
 * Responsabilidad:
 * - recibir un payload externo de Cal.com;
 * - validar los campos mínimos;
 * - convertirlo a un NormalizedBookingEvent estable para LeadFlow.
 *
 * Este módulo NO:
 * - accede a Firestore;
 * - accede a Secret Manager;
 * - verifica firmas;
 * - resuelve empresas o leads;
 * - aplica cambios de negocio;
 * - envía emails;
 * - escribe datos.
 */

const PROVIDER = "cal";

const SUPPORTED_EVENT_TYPES = new Set([
  "BOOKING_CREATED",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
]);

function isObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstInteger(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value;
    }

    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
  }

  return null;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeAttendee(payload) {
  const attendee =
    payload?.attendees?.[0] ??
    payload?.attendee ??
    payload?.booking?.attendees?.[0] ??
    payload?.booking?.attendee ??
    null;

  if (!isObject(attendee)) {
    return null;
  }

  const email = firstNonEmptyString(
    attendee.email,
    attendee.emailAddress
  );

  const name = firstNonEmptyString(
    attendee.name,
    attendee.fullName
  );

  if (!email) {
    return null;
  }

  return {
    email,
    name: name || null,
  };
}

function normalizeMetadata(payload) {
  const metadata =
    payload?.metadata ??
    payload?.booking?.metadata ??
    {};

  if (!isObject(metadata)) {
    return {};
  }

  return { ...metadata };
}

function getRawBooking(payload) {
  if (isObject(payload?.booking)) {
    return payload.booking;
  }

  return payload;
}

function normalizeEventType(payload) {
  const value = firstNonEmptyString(
    payload?.triggerEvent,
    payload?.event,
    payload?.eventType,
    payload?.booking?.triggerEvent,
    payload?.booking?.event,
    payload?.booking?.eventType
  );

  if (!value) {
    return null;
  }

  return value.toUpperCase();
}

function normalizeProviderBookingId(payload) {
  const booking = getRawBooking(payload);

  return firstNonEmptyString(
    booking?.id,
    booking?.bookingId,
    payload?.bookingId
  );
}

function normalizeProviderBookingUid(payload) {
  const booking = getRawBooking(payload);

  return firstNonEmptyString(
    booking?.uid,
    booking?.bookingUid,
    payload?.uid
  );
}

function normalizeProviderIcalUid(payload) {
  const booking = getRawBooking(payload);

  return firstNonEmptyString(
    booking?.iCalUID,
    booking?.icalUid,
    booking?.iCalUid,
    payload?.iCalUID,
    payload?.icalUid
  );
}

function normalizeRescheduleId(payload) {
  const booking = getRawBooking(payload);

  return firstNonEmptyString(
    booking?.rescheduleId,
    booking?.rescheduledFromUid,
    payload?.rescheduleId,
    payload?.rescheduledFromUid
  );
}

function normalizeStart(payload) {
  const booking = getRawBooking(payload);

  return normalizeDate(
    booking?.startTime ??
    booking?.start ??
    payload?.startTime ??
    payload?.start
  );
}

function normalizeEnd(payload) {
  const booking = getRawBooking(payload);

  return normalizeDate(
    booking?.endTime ??
    booking?.end ??
    payload?.endTime ??
    payload?.end
  );
}

function normalizeLocation(payload) {
  const booking = getRawBooking(payload);

  return firstNonEmptyString(
    booking?.location,
    payload?.location
  );
}

function normalizeSequence(payload) {
  const booking = getRawBooking(payload);

  return firstInteger(
    booking?.sequence,
    payload?.sequence
  );
}

function normalizeProviderEventId(payload) {
  return firstNonEmptyString(
    payload?.id,
    payload?.eventId,
  );
}

/*
 * Normaliza un webhook de Cal.com.
 *
 * connectionId se recibe desde la capa superior porque el payload externo
 * no debe decidir a qué conexión interna pertenece el evento.
 */
function normalizeCalBookingEvent(payload, { connectionId } = {}) {
  if (!isObject(payload)) {
    const error = new Error("Cal.com payload inválido");
    error.code = "CAL_PAYLOAD_INVALID";
    throw error;
  }

  if (typeof connectionId !== "string" || !connectionId.trim()) {
    const error = new Error("connectionId requerido");
    error.code = "CAL_CONNECTION_ID_REQUIRED";
    throw error;
  }

  const eventType = normalizeEventType(payload);

  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    const error = new Error(
      `Evento Cal.com no soportado: ${eventType || "desconocido"}`
    );
    error.code = "CAL_EVENT_TYPE_UNSUPPORTED";
    throw error;
  }

  const attendee = normalizeAttendee(payload);

  if (!attendee) {
    const error = new Error("Cal.com attendee inválido o sin email");
    error.code = "CAL_ATTENDEE_INVALID";
    throw error;
  }

  const providerBookingId = normalizeProviderBookingId(payload);
  const providerBookingUid = normalizeProviderBookingUid(payload);
  const providerIcalUid = normalizeProviderIcalUid(payload);

  if (!providerBookingId && !providerBookingUid && !providerIcalUid) {
    const error = new Error("Cal.com booking identity ausente");
    error.code = "CAL_BOOKING_ID_REQUIRED";
    throw error;
  }

  const start = normalizeStart(payload);
  const end = normalizeEnd(payload);

  /*
   * Los eventos de cancelación/reschedule pueden llegar con información
   * diferente según la versión del payload. Por ahora exigimos fechas para
   * los eventos que LeadFlow vaya a aplicar como booking activo.
   *
   * La capa de lifecycle podrá imponer reglas adicionales posteriormente.
   */
  if (eventType === "BOOKING_CREATED" && (!start || !end)) {
    const error = new Error("Cal.com booking requiere start y end");
    error.code = "CAL_BOOKING_DATES_REQUIRED";
    throw error;
  }

  return {
    provider: PROVIDER,
    connectionId: connectionId.trim(),
    eventType,
    providerEventId: normalizeProviderEventId(payload),
    providerBookingId,
    providerBookingUid,
    providerIcalUid,
    sequence: normalizeSequence(payload),
    rescheduleId: normalizeRescheduleId(payload),
    start,
    end,
    attendee,
    location: normalizeLocation(payload),
    metadata: normalizeMetadata(payload),
  };
}

module.exports = {
  PROVIDER,
  SUPPORTED_EVENT_TYPES,
  normalizeCalBookingEvent,
};
