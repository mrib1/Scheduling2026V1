
import React, { useState, useEffect, useMemo } from 'react';
import { SessionModalProps, ScheduleEntry, DayOfWeek, SessionType, Client, ValidationError } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { TrashIcon } from './icons/TrashIcon';
import { TIME_SLOTS_H_MM, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END } from '../constants';
import { timeToMinutes as convertTimeToMinutes, to12HourTime } from '../utils/validationService';

const ensureScheduleEntryId = (id?: string) => id || `schedEntry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  sessionData,
  newSessionSlot,
  clients,
  therapists,
  insuranceQualifications,
  availableSessionTypes,
  timeSlots: allTimeSlots,
  currentSchedule,
  currentError,
  clearError
}) => {
  const initialFormState: ScheduleEntry = {
    id: ensureScheduleEntryId(),
    clientName: null,
    clientId: null,
    therapistName: '',
    therapistId: '',
    day: DayOfWeek.MONDAY,
    startTime: '',
    endTime: '',
    sessionType: 'ABA',
  };

  const [formData, setFormData] = useState<ScheduleEntry>(initialFormState);
  const [formError, setFormError] = useState<ValidationError[] | null>(null);

  // Filter time slots to only show those within operating hours
  const visibleTimeSlots = useMemo(() => {
    const opStart = convertTimeToMinutes(COMPANY_OPERATING_HOURS_START);
    const opEnd = convertTimeToMinutes(COMPANY_OPERATING_HOURS_END);
    
    return allTimeSlots.filter(time => {
        const minutes = convertTimeToMinutes(time);
        return minutes >= opStart && minutes <= opEnd;
    });
  }, [allTimeSlots]);

  const calculateDefaultEndTime = (
    startTime: string,
    sessionType: SessionType,
    currentClientId: string | null,
    availableClients: Client[]
  ): string => {
    if (!startTime || !allTimeSlots || allTimeSlots.length === 0) return "";

    const startIndex = allTimeSlots.indexOf(startTime);
    if (startIndex === -1) return "";

    let durationMinutesDefault = 60;

    if (sessionType === 'IndirectTime') {
        durationMinutesDefault = 30;
    } else if ((sessionType === 'AlliedHealth_OT' || sessionType === 'AlliedHealth_SLP') && currentClientId) {
        const client = availableClients.find(c => c.id === currentClientId);
        const ahType = sessionType === 'AlliedHealth_OT' ? 'OT' : 'SLP';
        const need = client?.alliedHealthNeeds.find(n => n.type === ahType);
        if (need && need.durationMinutes > 0) {
            durationMinutesDefault = need.durationMinutes;
        } else {
            durationMinutesDefault = 45;
        }
    } else if (sessionType === 'AlliedHealth_OT' || sessionType === 'AlliedHealth_SLP') {
        durationMinutesDefault = 45;
    }

    const slotGranularity = 15;
    const durationInSlots = Math.ceil(durationMinutesDefault / slotGranularity);
    let proposedEndIndex = startIndex + durationInSlots;

    if (proposedEndIndex >= allTimeSlots.length) {
      proposedEndIndex = allTimeSlots.length - 1;
    }
    
    const operatingEndIndex = allTimeSlots.indexOf(COMPANY_OPERATING_HOURS_END);
     if (operatingEndIndex !== -1 && proposedEndIndex > operatingEndIndex) {
        if (sessionType !== 'IndirectTime') {
            proposedEndIndex = operatingEndIndex;
        } else if (proposedEndIndex > operatingEndIndex) {
            proposedEndIndex = operatingEndIndex;
        }
    }

    if (proposedEndIndex <= startIndex) {
      const nextSlotIndex = startIndex + 1;
      if (nextSlotIndex < allTimeSlots.length && (operatingEndIndex === -1 || nextSlotIndex <= operatingEndIndex)) {
        return allTimeSlots[nextSlotIndex];
      }
      return "";
    }
    return allTimeSlots[proposedEndIndex];
  };

  useEffect(() => {
    if (isOpen) {
      setFormError(null);
      if (sessionData) {
        setFormData({...sessionData, id: ensureScheduleEntryId(sessionData.id)});
      } else if (newSessionSlot) {
        const defaultSessionType: SessionType = 'ABA';
        const therapist = therapists.find(t => t.id === newSessionSlot.therapistId);
        setFormData({
          ...initialFormState,
          id: ensureScheduleEntryId(),
          therapistId: newSessionSlot.therapistId,
          therapistName: therapist ? therapist.name : newSessionSlot.therapistName,
          day: newSessionSlot.day,
          startTime: newSessionSlot.startTime,
          sessionType: defaultSessionType,
          clientId: clients.length > 0 ? clients[0].id : null,
          clientName: clients.length > 0 ? clients[0].name : null,
          endTime: calculateDefaultEndTime(newSessionSlot.startTime, defaultSessionType, clients.length > 0 ? clients[0].id : null, clients),
        });
      } else {
        setFormData({...initialFormState, id: ensureScheduleEntryId()});
      }
    }
  }, [isOpen, sessionData, newSessionSlot, clients, therapists]);

  const handleInputChange = (field: keyof ScheduleEntry, value: string | null | SessionType | DayOfWeek | string[]) => {
    setFormError(null);
    clearError();

    let newFormData = { ...formData, [field]: value };

    if (field === 'therapistId') {
        const therapist = therapists.find(t => t.id === value);
        newFormData.therapistName = therapist ? therapist.name : '';
    }

    if (field === 'clientId') {
        const client = clients.find(c => c.id === value);
        newFormData.clientName = client ? client.name : null;
         if (newFormData.sessionType === 'AlliedHealth_OT' || newFormData.sessionType === 'AlliedHealth_SLP') {
            newFormData.endTime = calculateDefaultEndTime(newFormData.startTime, newFormData.sessionType, value as string | null, clients);
        }
    }
    
    if (field === 'sessionType') {
        const newSessionType = value as SessionType;
        if (newSessionType === 'IndirectTime') {
            newFormData.clientName = null;
            newFormData.clientId = null;
        } else if (newFormData.clientId === null && clients.length > 0) {
             newFormData.clientId = clients[0].id;
             newFormData.clientName = clients[0].name;
        }
        newFormData.endTime = calculateDefaultEndTime(newFormData.startTime, newSessionType, newFormData.clientId, clients);
    }

    if (field === 'startTime') {
        newFormData.endTime = calculateDefaultEndTime(value as string, newFormData.sessionType, newFormData.clientId, clients);
    }
    
    setFormData(newFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();

    const localErrors: ValidationError[] = [];

    if (!formData.therapistId) {
      localErrors.push({ ruleId: "MISSING_THERAPIST", message: "Therapist must be selected."});
    }
    if (formData.sessionType !== 'IndirectTime' && !formData.clientId) {
      localErrors.push({ ruleId: "MISSING_CLIENT", message: "Client must be selected for non-indirect sessions."});
    }
    if (!formData.startTime || !formData.endTime) {
      localErrors.push({ ruleId: "MISSING_TIMES", message: "Start and end times are required."});
    } else if (convertTimeToMinutes(formData.startTime) >= convertTimeToMinutes(formData.endTime)) {
      localErrors.push({ ruleId: "INVALID_TIME_ORDER", message: "End time must be after start time."});
    }

    if (localErrors.length > 0) {
        setFormError(localErrors);
        return;
    }

    // Min Session Duration Check for Insurance
    if (formData.clientId) {
        const client = clients.find(c => c.id === formData.clientId);
        if (client) {
            const duration = convertTimeToMinutes(formData.endTime) - convertTimeToMinutes(formData.startTime);
            client.insuranceRequirements.forEach(reqId => {
                const qual = insuranceQualifications.find(q => q.id === reqId);
                if (qual && qual.minSessionDurationMinutes && duration < qual.minSessionDurationMinutes) {
                    localErrors.push({
                        ruleId: "MIN_DURATION_VIOLATED",
                        message: `${reqId} requires at least ${qual.minSessionDurationMinutes} mins. Current: ${duration} mins.`
                    });
                }
            });
        }
    }

    if (localErrors.length > 0) {
        setFormError(localErrors);
        return;
    }

    onSave(formData);
  };

  const handleDeleteClick = () => {
    if (onDelete && sessionData) {
      if (window.confirm(`Are you sure you want to delete this session for ${sessionData.clientName || 'Indirect Task'} with ${sessionData.therapistName}?`)) {
        onDelete(sessionData);
      }
    }
  };

  if (!isOpen) return null;

  const displayErrors = formError || currentError;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="session-modal-title">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 id="session-modal-title" className="text-2xl font-semibold text-slate-700">
            {sessionData ? 'Edit Session' : 'Add New Session'}
          </h2>
          <button onClick={() => { clearError(); onClose(); }} className="text-slate-500 hover:text-slate-700" aria-label="Close session modal">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {displayErrors && displayErrors.length > 0 && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-4 rounded-md text-sm" role="alert">
            <p className="font-bold mb-1">Please correct the following:</p>
            <ul className="list-disc list-inside space-y-0.5">
                {displayErrors.map((err, index) => (
                    <li key={index}>
                        <strong className="capitalize">{err.ruleId.replace(/_/g, ' ').toLowerCase()}:</strong> {err.message}
                    </li>
                ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="sessionDay" className="block text-sm font-medium text-slate-600">Day</label>
            <input
              type="text"
              id="sessionDay"
              value={formData.day}
              readOnly
              className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm bg-slate-100 cursor-not-allowed"
              aria-readonly="true"
            />
          </div>

          <div>
            <label htmlFor="sessionTherapist" className="block text-sm font-medium text-slate-600">Therapist</label>
            <select
              id="sessionTherapist"
              value={formData.therapistId}
              onChange={(e) => handleInputChange('therapistId', e.target.value)}
              className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select Therapist</option>
              {therapists.sort((a,b) => a.name.localeCompare(b.name)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="sessionType" className="block text-sm font-medium text-slate-600">Session Type</label>
            <select
              id="sessionType"
              value={formData.sessionType}
              onChange={(e) => handleInputChange('sessionType', e.target.value as SessionType)}
              className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {availableSessionTypes.map(type => <option key={type} value={type}>{type === 'IndirectTime' ? 'Lunch' : type}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="sessionClient" className="block text-sm font-medium text-slate-600">Client</label>
            <select
              id="sessionClient"
              value={formData.clientId || ""}
              onChange={(e) => handleInputChange('clientId', e.target.value === "" ? null : e.target.value)}
              disabled={formData.sessionType === 'IndirectTime'}
              className={`mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${formData.sessionType === 'IndirectTime' ? 'bg-slate-100 cursor-not-allowed' : ''}`}
              aria-disabled={formData.sessionType === 'IndirectTime'}
            >
              <option value="">N/A (Lunch)</option>
              {clients.sort((a,b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {formData.sessionType === 'IndirectTime' && <p className="text-xs text-slate-500 mt-1">Client is N/A for Lunch sessions.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="sessionStartTime" className="block text-sm font-medium text-slate-600">Start Time</label>
              <select
                id="sessionStartTime"
                value={formData.startTime}
                onChange={(e) => handleInputChange('startTime', e.target.value)}
                className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select Start</option>
                {visibleTimeSlots.map(time => <option key={`start-${time}`} value={time}>{to12HourTime(time)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sessionEndTime" className="block text-sm font-medium text-slate-600">End Time</label>
              <select
                id="sessionEndTime"
                value={formData.endTime}
                onChange={(e) => handleInputChange('endTime', e.target.value)}
                className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select End</option>
                {visibleTimeSlots.map(time => <option key={`end-${time}`} value={time}>{to12HourTime(time)}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4">
            <div>
              {sessionData && onDelete && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors flex items-center space-x-1.5"
                  aria-label="Delete Session"
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              )}
            </div>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => { clearError(); onClose(); }}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                Save Session
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SessionModal;
