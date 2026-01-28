
import { GoogleGenAI } from "@google/genai";
import { Client, Therapist, GeneratedSchedule, Callout } from '../types';
import { COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END } from '../constants';
import { timeToMinutes, minutesToTime } from '../utils/validationService';

// Initialize Gemini API Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function generateScheduleWithGemini(
  clients: Client[],
  therapists: Therapist[],
  date: Date,
  callouts: Callout[]
): Promise<GeneratedSchedule> {
  
  const dayName = getDayOfWeek(date);
  
  const prompt = `
    You are an expert ABA Therapy Scheduler. Your task is to generate an optimized daily schedule for a clinic.
    
    ### Context
    - **Date**: ${date.toDateString()} (${dayName})
    - **Operating Hours**: ${COMPANY_OPERATING_HOURS_START} to ${COMPANY_OPERATING_HOURS_END}
    - **Goal**: Maximize client coverage while respecting therapist availability and constraints.

    ### Data
    **Clients**: ${JSON.stringify(clients.map(c => ({ id: c.id, name: c.name, team: c.teamId, reqs: c.insuranceRequirements, needs: c.alliedHealthNeeds })))}
    **Therapists**: ${JSON.stringify(therapists.map(t => ({ id: t.id, name: t.name, team: t.teamId, quals: t.qualifications, allied: t.canProvideAlliedHealth })))}
    **Unavailability (Callouts)**: ${JSON.stringify(callouts)}

    ### Rules & Constraints
    1. **Sessions**: 
       - "ABA" sessions MUST be between 60 minutes (1 hour) and 180 minutes (3 hours). NEVER exceed 3 hours.
       - "AlliedHealth_OT" or "AlliedHealth_SLP" sessions follow the client's 'alliedHealthNeeds' duration (default 30-60 mins).
    2. **Matching**:
       - Therapist must have all qualifications listed in client's 'insuranceRequirements'.
       - For Allied Health, therapist must have 'OT' or 'SLP' in 'canProvideAlliedHealth'.
    3. **Lunches**:
       - Therapists working > 5 hours must have a 30-minute "IndirectTime" session between 11:00 and 14:00.
    4. **No Overlaps**: Neither clients nor therapists can be double-booked.
    5. **Availability**: Respect 'Callouts'. Do not schedule during callout times.
    6. **Format**: Return ONLY a valid JSON array of ScheduleEntry objects. No markdown formatting.

    ### Output Format (JSON Array)
    [
      {
        "id": "unique-string-id",
        "clientName": "Client Name" (or null for lunch),
        "clientId": "Client ID" (or null for lunch),
        "therapistName": "Therapist Name",
        "therapistId": "Therapist ID",
        "day": "${dayName}",
        "startTime": "HH:MM",
        "endTime": "HH:MM",
        "sessionType": "ABA" | "IndirectTime" | "AlliedHealth_OT" | "AlliedHealth_SLP"
      }
    ]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-thinking-preview-0121', // Using a model with good reasoning capabilities
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) {
        console.error("Gemini returned empty response");
        return [];
    }
    
    try {
        const schedule = JSON.parse(text) as GeneratedSchedule;
        // Post-processing: Ensure IDs and clamp durations
        return schedule.map(entry => {
            let entryEndTime = entry.endTime;
            let entryStartTime = entry.startTime;

            // Enforce 3h max for ABA by clamping end time
            if (entry.sessionType === 'ABA') {
               const startMin = timeToMinutes(entry.startTime);
               const endMin = timeToMinutes(entry.endTime);
               if (endMin - startMin > 180) {
                   entryEndTime = minutesToTime(startMin + 180);
               }
            }

            return {
                ...entry,
                startTime: entryStartTime,
                endTime: entryEndTime,
                id: entry.id || `gemini-${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
                day: entry.day || dayName as any // Ensure day is set
            };
        });
    } catch (parseError) {
        console.error("Failed to parse Gemini JSON response:", text);
        throw new Error("AI returned invalid JSON format.");
    }

  } catch (error) {
    console.error("Gemini Scheduling Failed:", error);
    throw new Error("Failed to generate schedule with Gemini. Please check API Key and try again.");
  }
}

function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}
