
import { DayOfWeek, TherapistRole, AlliedHealthServiceType } from './types';

export const DAYS_OF_WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
]; // Assuming standard Mon-Fri work week

export const COMPANY_OPERATING_HOURS_START = "09:00";
export const COMPANY_OPERATING_HOURS_END = "17:00";

// Export these constants as they are used by geneticAlgorithmService.ts
export const STAFF_ASSUMED_AVAILABILITY_START = "08:45"; 
export const STAFF_ASSUMED_AVAILABILITY_END = "17:15";   

export const TIME_SLOTS_H_MM: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) { // 15-min intervals for more granularity
    TIME_SLOTS_H_MM.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export const ALL_THERAPIST_ROLES: TherapistRole[] = ["RBT", "BCBA", "Clinical Fellow", "3 STAR", "Technician", "Other"];
export const ALL_ALLIED_HEALTH_SERVICES: AlliedHealthServiceType[] = ["OT", "SLP"];
export const ALL_SESSION_TYPES: string[] = ['ABA', 'AlliedHealth_OT', 'AlliedHealth_SLP', 'IndirectTime'];

// Core window for validation rule LUNCH_OUTSIDE_WINDOW
export const LUNCH_COVERAGE_START_TIME = "11:00"; 
export const LUNCH_COVERAGE_END_TIME = "14:00"; // Lunch must END by this time if starting in core window

// Preferred window for placing lunches by the algorithm
export const IDEAL_LUNCH_WINDOW_START = "11:00"; // Start as early as 11:00
export const IDEAL_LUNCH_WINDOW_END_FOR_START = "13:30"; // Last ideal START time for a 30-min lunch (ends at 14:00)

// Palette of colors for teams
export const TEAM_COLORS: string[] = [
  '#FBBF24', // Amber 400
  '#34D399', // Emerald 400
  '#60A5FA', // Blue 400
  '#F472B6', // Pink 400
  '#A78BFA', // Violet 400
  '#2DD4BF', // Teal 400
  '#F0ABFC', // Fuchsia 300
  '#FCA5A5', // Red 300
];

export const PALETTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.42 0 2.25 2.25 0 0 1-2.4-2.245 3 3 0 0 0-5.78-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.39m0 0A11.25 11.25 0 0 1 12 2.25a11.25 11.25 0 0 1 5.042 1.357m1.128 6.856A3 3 0 0 0 12 10.5a3 3 0 0 0-1.128 5.86m0 0a3 3 0 0 0 5.728 1.137 2.25 2.25 0 0 1 2.4 2.245 4.5 4.5 0 0 0-8.42 0 2.25 2.25 0 0 1 2.4-2.245 3 3 0 0 0 5.728-1.137Zm0 0a15.998 15.998 0 0 0-3.388-1.62m5.033.025a15.994 15.994 0 0 0-1.622-3.39m0 0a11.25 11.25 0 0 0-5.042-1.357A11.25 11.25 0 0 0 12 2.25a11.25 11.25 0 0 0-5.042 1.357m0 0c-.39.204-.774.434-1.144.686M7.5 4.5V6m13.5-1.5V6" /></svg>`;
