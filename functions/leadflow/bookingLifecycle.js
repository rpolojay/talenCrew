"use strict";

const { FieldValue } = require("firebase-admin/firestore");

const { COLLECTIONS, LEAD_STATUS, EVENT_TYPE } = require("./constants");
const { buildEventDoc } = require("./pipeline");

const BOOKABLE_STATUSES = [
  LEAD_STATUS.BOOKING_SENT,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.QUALIFIED,
  LEAD_STATUS.NURTURE,
  LEAD_STATUS.APPOINTMENT_BOOKED,
];

/**
 * Applies a normalized BOOKING_CREATED event to the LeadFlow lifecycle.
 *
 * Responsibilities:
 * - idempotency by booking UID
 * - tenant validation
 * - lead status validation
 * - atomic lead + booking + event writes
 *
 * No HTTP handling, webhook signature verification, secret access,
 * provider parsing, or email sending belongs here.
 */
async function applyBookingCreated(db, { leadId, companyId, booking }) {
  const bookingRef = db.collection(COLLECTIONS.BOOKINGS).doc(booking.uid);
  const leadRef = db.collection(COLLECTIONS.LEADS).doc(leadId);
  const events = db.collection(COLLECTIONS.EVENTS);

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    const leadSnap = await tx.get(leadRef);

    if (bookingSnap.exists) return { result: "duplicate" };
    if (!leadSnap.exists) return { result: "ignored_lead_not_found" };

    const lead = leadSnap.data();

    if (lead.companyId !== companyId) {
      return { result: "rejected_tenant_mismatch" };
    }

    const record = {
      uid: booking.uid,
      leadId,
      companyId,
      startTime: booking.startTime,
      endTime: booking.endTime,
      receivedAt: FieldValue.serverTimestamp(),
      leadStatusAtBooking: lead.status || null,
    };

    if (!BOOKABLE_STATUSES.includes(lead.status)) {
      tx.set(bookingRef, { ...record, outcome: "not_applied" });
      return {
        result: "not_applied_status",
        status: lead.status || null,
      };
    }

    const becomesBooked = lead.status !== LEAD_STATUS.APPOINTMENT_BOOKED;

    const update = {
      appointment: {
        calBookingUid: booking.uid,
        startTime: booking.startTime,
        endTime: booking.endTime,
        attendeeName: booking.attendeeName,
        attendeeEmail: booking.attendeeEmail,
        location: booking.location,
        confirmedAt: FieldValue.serverTimestamp(),
      },
      "followUp.stopped": true,
      "followUp.stopReason": "appointment_booked",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (becomesBooked) {
      update.status = LEAD_STATUS.APPOINTMENT_BOOKED;
    }

    tx.update(leadRef, update);

    tx.set(bookingRef, {
      ...record,
      outcome: "applied",
    });

    tx.set(
      events.doc(),
      buildEventDoc({
        leadId,
        companyId,
        type: EVENT_TYPE.BOOKING_CONFIRMED,
        actor: "system:cal_webhook",
        detail: {
          calBookingUid: booking.uid,
          startTime: booking.startTime,
        },
      })
    );

    if (becomesBooked) {
      tx.set(
        events.doc(),
        buildEventDoc({
          leadId,
          companyId,
          type: EVENT_TYPE.STATUS_CHANGE,
          fromStatus: lead.status || null,
          toStatus: LEAD_STATUS.APPOINTMENT_BOOKED,
          actor: "system:cal_webhook",
        })
      );
    }

    return {
      result: becomesBooked ? "applied" : "applied_additional_booking",
    };
  });
}

module.exports = {
  BOOKABLE_STATUSES,
  applyBookingCreated,
};
