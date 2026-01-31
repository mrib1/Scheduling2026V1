
import { ScheduleEntry, GeneratedSchedule, Client, Therapist, DayOfWeek, AlliedHealthServiceType, ValidationError, Callout } from '../types';
import { COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, STAFF_ASSUMED_AVAILABILITY_START, STAFF_ASSUMED_AVAILABILITY_END, LUNCH_COVERAGE_START_TIME, LUNCH_COVERAGE_END_TIME } from '../constants'; // Use constants

export const timeToMinutes = (time: string): number => {
  if (!time) return 0;
  // Performance optimization: assume HH:MM format
  const h = parseInt(time.substring(0, 2), 10);
  const m = parseInt(time.substring(3, 5), 10);
  return (h * 60) + m;
};

export const minutesToTime = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const to12HourTime = (time24: string): string => {
  if (!time24) return '';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
};

export const sessionsOverlap = (
    entry1Start: string, entry1End: string,
    entry2Start: string, entry2End: string
): boolean => {
  const start1 = timeToMinutes(entry1Start);
  const end1 = timeToMinutes(entry1End);
  const start2 = timeToMinutes(entry2Start);
  const end2 = timeToMinutes(entry2End);
  return start1 < end2 && start2 < end1;
};

export const validateSessionEntry = (
  entryToValidate: ScheduleEntry,
  currentSchedule: GeneratedSchedule,
  clients: Client[],
  therapists: Therapist[],
  originalEntryForEditId?: string | null
): ValidationError[] => {
  const errors: ValidationError[] = [];
  const { clientId, clientName, therapistId, therapistName, day, startTime, endTime, sessionType } = entryToValidate;

  if (!startTime || !endTime) {
    errors.push({ ruleId: "MISSING_TIMES", message: "Session start and end times are required." });
    return [...new Map(errors.map(item => [item.ruleId + item.message, item])).values()];
  }

  const startTimeMinutes = timeToMinutes(startTime);
  const endTimeMinutes = timeToMinutes(endTime);

  if (startTimeMinutes >= endTimeMinutes) {
    errors.push({ ruleId: "INVALID_TIME_ORDER", message: "Session end time must be after start time." });
  }

  const therapistData = therapists.find(t => t.id === therapistId);
  if (!therapistData) {
     errors.push({ ruleId: "THERAPIST_NOT_FOUND", message: `Therapist "${therapistName}" (ID: ${therapistId}) not found.`});
  } else {
    if (startTimeMinutes < timeToMinutes(STAFF_ASSUMED_AVAILABILITY_START) ||
        endTimeMinutes > timeToMinutes(STAFF_ASSUMED_AVAILABILITY_END)) {
      errors.push({
          ruleId: "OUTSIDE_THERAPIST_AVAILABILITY",
          message: `Session for ${therapistName} (${to12HourTime(startTime)}-${to12HourTime(endTime)}) is outside their availability window (${to12HourTime(STAFF_ASSUMED_AVAILABILITY_START)} - ${to12HourTime(STAFF_ASSUMED_AVAILABILITY_END)}).`
      });
    }
  }

  if (sessionType === 'ABA' || sessionType === 'AlliedHealth_OT' || sessionType === 'AlliedHealth_SLP') {
    if (startTimeMinutes < timeToMinutes(COMPANY_OPERATING_HOURS_START) ||
        endTimeMinutes > timeToMinutes(COMPANY_OPERATING_HOURS_END)) {
      errors.push({
          ruleId: "OUTSIDE_OPERATING_HOURS",
          message: `Client-facing session (${sessionType}) must be within company operating hours (${to12HourTime(COMPANY_OPERATING_HOURS_START)} - ${to12HourTime(COMPANY_OPERATING_HOURS_END)}).`
      });
    }
  }

  const isWeekend = day === DayOfWeek.SATURDAY || day === DayOfWeek.SUNDAY;
  if (isWeekend) {
    if (sessionType === 'ABA') {
      errors.push({ ruleId: "ABA_ON_WEEKEND", message: `ABA sessions cannot be scheduled on weekends (${day}).` });
    }
  }

  currentSchedule.forEach(existingEntry => {
    if (originalEntryForEditId && existingEntry.id === originalEntryForEditId) return;
    if (existingEntry.id === entryToValidate.id && originalEntryForEditId !== entryToValidate.id) return; 

    if (existingEntry.therapistId === therapistId &&
        existingEntry.day === day &&
        sessionsOverlap(existingEntry.startTime, existingEntry.endTime, startTime, endTime)) {
      errors.push({
          ruleId: "THERAPIST_TIME_CONFLICT",
          message: `Therapist ${therapistName} is already booked from ${to12HourTime(existingEntry.startTime)}-${to12HourTime(existingEntry.endTime)} with ${existingEntry.clientName || 'Indirect Task'}.`,
          details: { entryId: entryToValidate.id, conflictingEntryId: existingEntry.id }
      });
    }

    if (clientId && existingEntry.clientId === clientId &&
        existingEntry.day === day &&
        sessionsOverlap(existingEntry.startTime, existingEntry.endTime, startTime, endTime)) {
      errors.push({
          ruleId: "CLIENT_TIME_CONFLICT",
          message: `Client ${clientName} is already scheduled with ${existingEntry.therapistName} from ${to12HourTime(existingEntry.startTime)}-${to12HourTime(existingEntry.endTime)}.`,
          details: { entryId: entryToValidate.id, conflictingEntryId: existingEntry.id }
      });
    }

    // Check for back-to-back same client sessions (no break allowed)
    if (clientId && existingEntry.clientId === clientId &&
        existingEntry.therapistId === therapistId &&
        existingEntry.day === day &&
        (existingEntry.endTime === startTime || existingEntry.startTime === endTime)) {
      errors.push({
          ruleId: "SAME_CLIENT_BACK_TO_BACK",
          message: `Therapist ${therapistName} cannot work with client ${clientName} back-to-back without a break. There must be at least a 15-minute gap or a different session between consecutive sessions with the same client.`,
          details: { entryId: entryToValidate.id, conflictingEntryId: existingEntry.id }
      });
    }
  });

  if (clientId) {
    const clientData = clients.find(c => c.id === clientId);
    if (!clientData) {
        errors.push({ ruleId: "CLIENT_NOT_FOUND", message: `Client "${clientName}" (ID: ${clientId}) not found.`});
    } else {
        if (therapistData && clientData.insuranceRequirements.length > 0) {
            const unmetRequirements = clientData.insuranceRequirements.filter(
              req => !therapistData.qualifications.includes(req)
            );
            if (unmetRequirements.length > 0) {
              errors.push({
                  ruleId: "INSURANCE_MISMATCH",
                  message: `Therapist ${therapistName} does not meet insurance requirements for ${clientName}: ${unmetRequirements.join(', ')}.`,
                  details: { entryId: entryToValidate.id }
              });
            }
        }
    }
  }


  if (sessionType === 'AlliedHealth_OT' || sessionType === 'AlliedHealth_SLP') {
    const serviceType = sessionType === 'AlliedHealth_OT' ? 'OT' : 'SLP';
    if (therapistData && !therapistData.canProvideAlliedHealth.includes(serviceType)) {
      errors.push({
          ruleId: "ALLIED_HEALTH_QUALIFICATION_MISSING",
          message: `Therapist ${therapistName} cannot provide ${serviceType} services.`,
          details: { entryId: entryToValidate.id }
      });
    }
    const requiredQual = serviceType === 'OT' ? "OT Certified" : "SLP Certified"; 
     if (therapistData && !therapistData.qualifications.includes(requiredQual)) {
        errors.push({
          ruleId: "ALLIED_HEALTH_CERTIFICATION_MISSING",
          message: `Therapist ${therapistName} lacks qualification "${requiredQual}" for ${serviceType}.`,
          details: { entryId: entryToValidate.id }
      });
     }
  }

  const duration = endTimeMinutes - startTimeMinutes;
  if (sessionType === 'ABA') {
    if (duration < 60) errors.push({ ruleId: "ABA_DURATION_TOO_SHORT", message: "ABA session must be at least 60 minutes." });
    if (duration > 180) errors.push({ ruleId: "ABA_DURATION_TOO_LONG", message: "ABA session cannot exceed 180 minutes." });
  } else if (sessionType === 'AlliedHealth_OT' || sessionType === 'AlliedHealth_SLP') {
    if (duration <= 0) errors.push({ ruleId: "ALLIED_HEALTH_DURATION_INVALID", message: `${sessionType} session must have positive duration.` });
  } else if (sessionType === 'IndirectTime') { 
     if (duration !== 30) errors.push({ ruleId: "LUNCH_DURATION_INVALID", message: `Lunch/Indirect Time must be exactly 30 minutes.`});
  }

  if ((sessionType === 'IndirectTime' || sessionType === 'AdminTime') && clientId !== null) {
    errors.push({ ruleId: "INDIRECT_TIME_CLIENT_SPECIFIED", message: `Client must be N/A for ${sessionType}.` });
  }
  if (sessionType !== 'IndirectTime' && sessionType !== 'AdminTime' && clientId === null) {
    errors.push({ ruleId: "CLIENT_REQUIRED_FOR_SESSION", message: `Client must be specified for ${sessionType}.` });
  }

  return [...new Map(errors.map(item => [item.ruleId + item.message, item])).values()];
};

const getDayOfWeekFromDateObject = (date: Date): DayOfWeek => {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        console.warn("Invalid date passed to getDayOfWeekFromDateObject, falling back to today.");
        const today = new Date();
        const dayIndexFallback = today.getDay();
        const daysMapFallback: DayOfWeek[] = [ DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY];
        return daysMapFallback[dayIndexFallback];
    }
    const dayIndex = date.getDay();
    const daysMap: DayOfWeek[] = [ DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY ];
    return daysMap[dayIndex];
};

export const isDateAffectedByCalloutRange = (currentDate: Date, calloutStartDateStr: string, calloutEndDateStr: string): boolean => {
    if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) return false; 
    
    const currentDayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();

    let calloutStartDayStart, calloutEndDayStart;
    try {
        const csdParts = calloutStartDateStr.split('-');
        calloutStartDayStart = new Date(parseInt(csdParts[0]), parseInt(csdParts[1]) - 1, parseInt(csdParts[2])).getTime();

        const cedParts = calloutEndDateStr.split('-');
        calloutEndDayStart = new Date(parseInt(cedParts[0]), parseInt(cedParts[1]) - 1, parseInt(cedParts[2])).getTime();

        if (isNaN(calloutStartDayStart) || isNaN(calloutEndDayStart)) return false;

    } catch(e) {
        return false;
    }
    
    return currentDayStart >= calloutStartDayStart && currentDayStart <= calloutEndDayStart;
};


export const validateFullSchedule = (
  scheduleToValidate: GeneratedSchedule,
  clients: Client[],
  therapists: Therapist[],
  selectedDate: Date | null, 
  operatingHoursStart: string,
  operatingHoursEnd: string,
  callouts: Callout[]
): ValidationError[] => {
  let allErrors: ValidationError[] = [];

  if (!scheduleToValidate) return [];
  if (scheduleToValidate.length === 0 && clients.length === 0 && therapists.length === 0 && !selectedDate) return [];

  if (!selectedDate || !(selectedDate instanceof Date) || isNaN(selectedDate.getTime())) {
    allErrors.push({ ruleId: "INVALID_SELECTED_DATE", message: "Selected date for validation is invalid." });
    return [...new Map(allErrors.map(item => [item.ruleId + item.message, item])).values()]; 
  }

  const currentDayOfWeekString = getDayOfWeekFromDateObject(selectedDate);
  const isWeekendDay = currentDayOfWeekString === DayOfWeek.SATURDAY || currentDayOfWeekString === DayOfWeek.SUNDAY;

  scheduleToValidate.forEach((entryToValidate) => {
    if (entryToValidate.day !== currentDayOfWeekString) {
      allErrors.push({
        ruleId: "WRONG_DAY_FOR_ENTRY",
        message: `Entry for ${entryToValidate.clientName || 'Indirect'} with ${entryToValidate.therapistName} is scheduled on ${entryToValidate.day} but should be on ${currentDayOfWeekString}. (ID: ${entryToValidate.id})`
      });
    }

    const entryErrors = validateSessionEntry(entryToValidate, scheduleToValidate, clients, therapists, entryToValidate.id); 

    if (entryErrors.length > 0) {
      allErrors = [...allErrors, ...entryErrors.map(e => ({
          ...e,
          message: `Entry (${entryToValidate.therapistName} with ${entryToValidate.clientName || 'N/A'} at ${to12HourTime(entryToValidate.startTime)} on ${entryToValidate.day}, ID: ${entryToValidate.id}): ${e.message}`
      }))];
    }

    const entryCallouts = callouts.filter(co =>
        isDateAffectedByCalloutRange(selectedDate, co.startDate, co.endDate) && 
        ( (co.entityType === 'therapist' && co.entityId === entryToValidate.therapistId) ||
          (co.entityType === 'client' && co.entityId === entryToValidate.clientId) ) &&
        sessionsOverlap(entryToValidate.startTime, entryToValidate.endTime, co.startTime, co.endTime)
    );

    if (entryCallouts.length > 0) {
        entryCallouts.forEach(co => {
            allErrors.push({
                ruleId: "SESSION_OVERLAPS_CALLOUT",
                message: `Session for ${entryToValidate.therapistName} with ${entryToValidate.clientName || 'N/A'} (${to12HourTime(entryToValidate.startTime)}-${to12HourTime(entryToValidate.endTime)}, ID: ${entryToValidate.id}) overlaps with ${co.entityType} ${co.entityName}'s callout (${to12HourTime(co.startTime)}-${to12HourTime(co.endTime)}). Reason: ${co.reason || 'N/A'}`
            });
        });
    }
  });

  const scheduledTherapistIds = new Set(scheduleToValidate.map(s => s.therapistId));
  scheduledTherapistIds.forEach(therapistId => {
    const therapist = therapists.find(t => t.id === therapistId);
    if (!therapist) return; 

    const therapistSessions = scheduleToValidate.filter(s => s.therapistId === therapistId && s.day === currentDayOfWeekString);
    
    const billableSessions = therapistSessions.filter(s => s.sessionType === 'ABA' || s.sessionType === 'AlliedHealth_OT' || s.sessionType === 'AlliedHealth_SLP');
    if (billableSessions.length > 4) {
      allErrors.push({
        ruleId: "MAX_NOTES_EXCEEDED",
        message: `Therapist ${therapist.name} has ${billableSessions.length} billable sessions (notes), which is high.`
      });
    }

    // BCBA Direct Time check
    if(therapist.qualifications.includes("BCBA") && billableSessions.length === 0 && therapistSessions.length > 0){
        allErrors.push({
            ruleId: "BCBA_NO_DIRECT_TIME",
            message: `Therapist ${therapist.name} is a BCBA but has no direct client time scheduled.`
        });
    }

    const lunchSessions = therapistSessions.filter(s =>
        (s.sessionType === 'IndirectTime' || s.sessionType === 'AdminTime') && s.clientId === null
    );

    if (billableSessions.length > 0) { 
        if (lunchSessions.length === 0) {
            allErrors.push({
                ruleId: "MISSING_LUNCH_BREAK",
                message: `Therapist ${therapist.name} has billable work but no lunch break scheduled.`
            });
        } else { 
            // Check if AT LEAST ONE session is a valid lunch (IndirectTime in window)
            const validLunches = lunchSessions.filter(s => {
                if (s.sessionType !== 'IndirectTime') return false;
                const lunchStartMinutes = timeToMinutes(s.startTime);
                const idealWindowStartMinutes = timeToMinutes(LUNCH_COVERAGE_START_TIME);
                const idealWindowEndMinutesForLunchEnd = timeToMinutes(LUNCH_COVERAGE_END_TIME);
                const latestIdealStartTimeFor30MinLunch = idealWindowEndMinutesForLunchEnd - 30;
                return lunchStartMinutes >= idealWindowStartMinutes && lunchStartMinutes <= latestIdealStartTimeFor30MinLunch;
            });

            if (validLunches.length === 0) {
                allErrors.push({
                    ruleId: "LUNCH_OUTSIDE_WINDOW",
                    message: `Therapist ${therapist.name} has no valid lunch break (30min IndirectTime) within the core window (${to12HourTime(LUNCH_COVERAGE_START_TIME)} - ${to12HourTime(LUNCH_COVERAGE_END_TIME)}).`
                });
            } else if (validLunches.length > 1) {
                allErrors.push({
                    ruleId: "MULTIPLE_LUNCHES",
                    message: `Therapist ${therapist.name} has ${validLunches.length} lunch sessions in the core window. Only one is allowed.`
                });
            }
        }
    } else if (lunchSessions.length > 0) { 
         allErrors.push({
            ruleId: "LUNCH_WITHOUT_BILLABLE_WORK",
            message: `Therapist ${therapist.name} has a lunch break scheduled but no billable work.`
        });
    }

    if (isWeekendDay && therapistSessions.length > 0) {
      if (therapistSessions.some(s => s.sessionType === 'ABA')) { 
         allErrors.push({
          ruleId: "THERAPIST_WEEKEND_ABA",
          message: `Therapist ${therapist.name} has an ABA session scheduled on a weekend, which is not permitted.`
        });
      }
    }
  });
  
  // Client-specific aggregate checks
  clients.forEach(client => {
      const clientSessionsToday = scheduleToValidate.filter(s => s.clientId === client.id && s.day === currentDayOfWeekString);
      
      // MD Medicaid Check
      if (client.insuranceRequirements.includes("MD_MEDICAID")) {
          const uniqueTherapists = new Set(clientSessionsToday.map(s => s.therapistId));
          if (uniqueTherapists.size > 3) {
              allErrors.push({
                  ruleId: "MD_MEDICAID_LIMIT_VIOLATED",
                  message: `MD Medicaid client ${client.name} is scheduled with ${uniqueTherapists.size} unique therapists, exceeding the limit of 3.`
              });
          }
      }

      // Coverage Gap Check
      if (!isWeekendDay) {
          const opStartMinutes = timeToMinutes(operatingHoursStart);
          const opEndMinutes = timeToMinutes(operatingHoursEnd);

          const clientCalloutsForDay = callouts.filter(co =>
              co.entityType === 'client' &&
              co.entityId === client.id &&
              isDateAffectedByCalloutRange(selectedDate, co.startDate, co.endDate)
          ).map(co => ({
              start: timeToMinutes(co.startTime),
              end: timeToMinutes(co.endTime)
          })).sort((a,b) => a.start - b.start);

          const mergedClientUnavailablePeriods = clientCalloutsForDay.reduce((acc, current) => {
            if (acc.length === 0) return [current];
            const last = acc[acc.length - 1];
            if (current.start <= last.end) { 
              last.end = Math.max(last.end, current.end);
            } else {
              acc.push(current);
            }
            return acc;
          }, [] as {start: number, end: number}[]);

          const clientABASessionsToday = clientSessionsToday.filter(s => s.sessionType === 'ABA');
          const clientAHSessionsToday = clientSessionsToday.filter(s => s.sessionType.startsWith('AlliedHealth_'));

          for (let intervalStart = opStartMinutes; intervalStart < opEndMinutes; intervalStart += 15) {
            const intervalEnd = intervalStart + 15;

            const isDuringClientCallout = mergedClientUnavailablePeriods.some(unavailablePeriod => 
                intervalStart < unavailablePeriod.end && intervalEnd > unavailablePeriod.start
            );
            if (isDuringClientCallout) continue; 

            const isDuringAH = clientAHSessionsToday.some(session => {
                const sessionStartMinutes = timeToMinutes(session.startTime);
                const sessionEndMinutes = timeToMinutes(session.endTime);
                return intervalStart < sessionEndMinutes && intervalEnd > sessionStartMinutes;
            });
            if (isDuringAH) continue;

            const isCoveredByABASession = clientABASessionsToday.some(session => {
                const sessionStartMinutes = timeToMinutes(session.startTime);
                const sessionEndMinutes = timeToMinutes(session.endTime);
                return intervalStart < sessionEndMinutes && intervalEnd > sessionStartMinutes;
            });

            if (!isCoveredByABASession) {
              allErrors.push({
                ruleId: "CLIENT_COVERAGE_GAP_AT_TIME",
                message: `Client ${client.name} has an ABA coverage gap on ${currentDayOfWeekString} from ${to12HourTime(minutesToTime(intervalStart))} to ${to12HourTime(minutesToTime(intervalEnd))}.`,
                details: { clientId: client.id, time: minutesToTime(intervalStart) }
              });
            }
          }
      }
  });


  return [...new Map(allErrors.map(item => [item.ruleId + item.message, item])).values()];
};
