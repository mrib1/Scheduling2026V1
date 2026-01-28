import { Client, Therapist, GeneratedSchedule, DayOfWeek, Callout, GAGenerationResult, ScheduleEntry, SessionType, BaseScheduleConfig, AlliedHealthNeed } from '../types';
import { COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, IDEAL_LUNCH_WINDOW_START, IDEAL_LUNCH_WINDOW_END_FOR_START, LUNCH_COVERAGE_START_TIME, LUNCH_COVERAGE_END_TIME } from '../constants';
import { validateFullSchedule, timeToMinutes, minutesToTime, sessionsOverlap, isDateAffectedByCalloutRange } from '../utils/validationService';
import * as baseScheduleService from './baseScheduleService';
import { ScheduleLearningService } from './scheduleLearningService';
import {
  canAddEntryToSchedule,
  getClientCoverageGaps,
  isWithinOperatingHours,
  isSessionDurationValid
} from './constraintValidator';

// --- GA Configuration ---
const POPULATION_SIZE = 50;
const MAX_GENERATIONS = 150; 
const ELITISM_RATE = 0.1;
const CROSSOVER_RATE = 0.7;
const MUTATION_RATE = 0.95; 
const PLATEAU_LIMIT = 30; // Early termination if no improvement

// --- Helper Functions ---
const generateId = () => `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const getDayOfWeekFromDate = (date: Date): DayOfWeek => {
    const days: DayOfWeek[] = [DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY];
    return days[date.getDay()];
};
const getTherapistById = (therapists: Therapist[], id: string) => therapists.find(t => t.id === id);
const getClientById = (clients: Client[], id: string) => clients.find(c => c.id === id);
const cloneSchedule = (schedule: GeneratedSchedule): GeneratedSchedule => structuredClone(schedule);

// --- Learning Context ---
interface LearningContext {
    topRatedSchedules: GeneratedSchedule[];
    learnedLunchTimes: Array<{ therapistId: string; startTime: string; endTime: string }>;
    violationPenalties: Record<string, number>;
}

async function loadLearningContext(): Promise<LearningContext> {
    try {
        const topRatedSchedules = await ScheduleLearningService.getHighRatedSchedules();
        const learnedLunchTimes = topRatedSchedules
            .flatMap(s => s.filter(e => e.sessionType === 'IndirectTime'))
            .map(e => ({ therapistId: e.therapistId, startTime: e.startTime, endTime: e.endTime }));
        
        return { topRatedSchedules, learnedLunchTimes, violationPenalties: {} };
    } catch (error) {
        console.warn("Failed to load learning context, using defaults.", error);
        return { topRatedSchedules: [], learnedLunchTimes: [], violationPenalties: {} };
    }
}

// --- Adaptive Penalty Calculation ---
function calculateAdaptivePenalties(clients: Client[], therapists: Therapist[], schedule: GeneratedSchedule) {
    const numClients = clients.length;
    const numTherapists = therapists.length;
    const scaleFactor = Math.max(1, Math.log2(numClients * numTherapists));
    
    return {
        CONFLICT_PENALTY: 5000 * scaleFactor,
        CREDENTIAL_MISMATCH_PENALTY: 4000 * scaleFactor,
        CALLOUT_OVERLAP_PENALTY: 4500 * scaleFactor,
        CLIENT_COVERAGE_GAP_PENALTY: 2000 * scaleFactor * (numClients / 10),
        MISSING_LUNCH_PENALTY: 2500 * scaleFactor,
        LUNCH_STAGGER_PENALTY: 800 * scaleFactor,
        SESSION_DURATION_PENALTY: 1000 * scaleFactor,
        MD_MEDICAID_LIMIT_PENALTY: 2000 * scaleFactor,
        BCBA_DIRECT_TIME_PENALTY: 500,
        UNMET_AH_NEED_PENALTY: 300,
        BASE_SCHEDULE_DEVIATION_PENALTY: 50,
        TEAM_ALIGNMENT_PENALTY: 100,
        MAX_NOTES_PENALTY: 50,
        LUNCH_OUTSIDE_WINDOW_PENALTY: 200,
        SCHEDULE_FRAGMENTATION_PENALTY: 10,
        CONTINUOUS_WORK_WITHOUT_BREAK_PENALTY: 3500 * scaleFactor,
        SAME_CLIENT_BACK_TO_BACK_PENALTY: 6000 * scaleFactor  // Very high penalty - this is a hard constraint
    };
}

// --- NEW: Check for continuous work without breaks ---
function detectContinuousWorkViolations(schedule: GeneratedSchedule, therapists: Therapist[]): number {
    let violations = 0;
    const MAX_CONTINUOUS_WORK_MINUTES = 180; // 3 hours

    therapists.forEach(therapist => {
        const therapistSessions = schedule
            .filter(s => s.therapistId === therapist.id)
            .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

        if (therapistSessions.length === 0) return;

        let continuousWorkStart = timeToMinutes(therapistSessions[0].startTime);
        let lastEndTime = timeToMinutes(therapistSessions[0].endTime);

        for (let i = 1; i < therapistSessions.length; i++) {
            const currentStart = timeToMinutes(therapistSessions[i].startTime);
            const currentEnd = timeToMinutes(therapistSessions[i].endTime);
            const isBreak = therapistSessions[i].sessionType === 'IndirectTime';

            // Check if sessions are back-to-back (gap <= 15 minutes)
            const gap = currentStart - lastEndTime;
            
            if (gap <= 15 && !isBreak) {
                // Continue the continuous work period
                lastEndTime = currentEnd;
                
                // Check if we've exceeded max continuous work
                const continuousWorkMinutes = lastEndTime - continuousWorkStart;
                if (continuousWorkMinutes > MAX_CONTINUOUS_WORK_MINUTES) {
                    violations++;
                }
            } else if (isBreak && gap <= 15) {
                // This is a break, reset continuous work tracking
                continuousWorkStart = currentEnd; // Start new period after break
                lastEndTime = currentEnd;
            } else {
                // Gap > 15 minutes and not continuous, reset
                continuousWorkStart = currentStart;
                lastEndTime = currentEnd;
            }
        }
    });

    return violations;
}

// --- Optimized Availability Tracker ---
class AvailabilityTracker {
    private therapistMasks: Map<string, bigint>;
    private clientMasks: Map<string, bigint>;
    private scheduleByEntry: Map<string, { therapistId: string; clientId: string | null; start: number; end: number }>;

    constructor(schedule: GeneratedSchedule, callouts: Callout[], selectedDate: Date) {
        this.therapistMasks = new Map();
        this.clientMasks = new Map();
        this.scheduleByEntry = new Map();
        this.rebuild(schedule, callouts, selectedDate);
    }

    private timeToBit(timeStr: string | number): number {
        const mins = typeof timeStr === 'string' ? timeToMinutes(timeStr) : timeStr;
        return Math.floor(mins / 15);
    }

    private getRangeMask(start: number, end: number): bigint {
        const startBit = this.timeToBit(start);
        const endBit = this.timeToBit(end);
        const length = endBit - startBit;
        if (length <= 0) return 0n;
        return ((1n << BigInt(length)) - 1n) << BigInt(startBit);
    }

    public rebuild(schedule: GeneratedSchedule, callouts: Callout[], selectedDate: Date) {
        this.therapistMasks.clear();
        this.clientMasks.clear();
        this.scheduleByEntry.clear();

        // Store entry details for fast ignore
        schedule.forEach(s => {
            this.scheduleByEntry.set(s.id, {
                therapistId: s.therapistId,
                clientId: s.clientId,
                start: timeToMinutes(s.startTime),
                end: timeToMinutes(s.endTime)
            });
        });

        // Apply callouts
        callouts.forEach(co => {
            if (isDateAffectedByCalloutRange(selectedDate, co.startDate, co.endDate)) {
                const mask = this.getRangeMask(timeToMinutes(co.startTime), timeToMinutes(co.endTime));
                if (co.entityType === 'therapist') {
                    const current = this.therapistMasks.get(co.entityId) || 0n;
                    this.therapistMasks.set(co.entityId, current | mask);
                } else {
                    const current = this.clientMasks.get(co.entityId) || 0n;
                    this.clientMasks.set(co.entityId, current | mask);
                }
            }
        });

        // Apply schedule
        schedule.forEach(s => {
            const mask = this.getRangeMask(timeToMinutes(s.startTime), timeToMinutes(s.endTime));
            
            const tMask = this.therapistMasks.get(s.therapistId) || 0n;
            this.therapistMasks.set(s.therapistId, tMask | mask);

            if (s.clientId) {
                const cMask = this.clientMasks.get(s.clientId) || 0n;
                this.clientMasks.set(s.clientId, cMask | mask);
            }
        });
    }

    public isAvailable(
        entityType: 'therapist' | 'client', 
        entityId: string, 
        start: number, 
        end: number, 
        ignoreEntryId?: string
    ): boolean {
        const queryMask = this.getRangeMask(start, end);
        let entityMask = (entityType === 'therapist' 
            ? this.therapistMasks.get(entityId) 
            : this.clientMasks.get(entityId)) || 0n;

        // Handle ignoreEntryId efficiently
        if (ignoreEntryId) {
            const ignoredEntry = this.scheduleByEntry.get(ignoreEntryId);
            if (ignoredEntry && 
                ((entityType === 'therapist' && ignoredEntry.therapistId === entityId) ||
                 (entityType === 'client' && ignoredEntry.clientId === entityId))) {
                const ignoreMask = this.getRangeMask(ignoredEntry.start, ignoredEntry.end);
                entityMask = entityMask & ~ignoreMask;
            }
        }

        return (entityMask & queryMask) === 0n;
    }

    public book(therapistId: string, clientId: string | null, start: number, end: number) {
        const mask = this.getRangeMask(start, end);
        
        const tMask = this.therapistMasks.get(therapistId) || 0n;
        this.therapistMasks.set(therapistId, tMask | mask);

        if (clientId) {
            const cMask = this.clientMasks.get(clientId) || 0n;
            this.clientMasks.set(clientId, cMask | mask);
        }
    }
}

// --- Constructive Heuristic Initialization ---
function constructiveHeuristicInitialization(
    clients: Client[],
    therapists: Therapist[],
    day: DayOfWeek,
    selectedDate: Date,
    callouts: Callout[],
    baseScheduleForDay?: BaseScheduleConfig | null,
    learningContext?: LearningContext
): GeneratedSchedule {
    let schedule: GeneratedSchedule = [];
    
    // 1. Load Base Schedule (if exists)
    if (baseScheduleForDay?.schedule) {
        schedule = baseScheduleForDay.schedule.filter(entry => {
            const hasConflict = callouts.some(co =>
                (co.entityId === entry.clientId || co.entityId === entry.therapistId) &&
                isDateAffectedByCalloutRange(selectedDate, co.startDate, co.endDate) &&
                sessionsOverlap(entry.startTime, entry.endTime, co.startTime, co.endTime)
            );
            return !hasConflict && entry.day === day;
        }).map(e => ({...e, id: generateId()}));
    }

    const tracker = new AvailabilityTracker(schedule, callouts, selectedDate);
    const opStartMins = timeToMinutes(COMPANY_OPERATING_HOURS_START);
    const opEndMins = timeToMinutes(COMPANY_OPERATING_HOURS_END);

    // 2. Define Planning Tasks
    interface PlanningTask {
        clientId: string;
        clientName: string;
        type: SessionType;
        minDuration: number;
        maxDuration: number;
        priority: number;
        possibleTherapists: Therapist[];
        preferredStart?: number;
        preferredEnd?: number;
    }

    let tasks: PlanningTask[] = [];

    clients.forEach(client => {
        // Allied Health Tasks
        client.alliedHealthNeeds.forEach(need => {
            const existing = schedule.filter(s => s.clientId === client.id && s.sessionType.includes(need.type)).length;
            if (existing < need.frequencyPerWeek) {
                const qualified = therapists.filter(t => 
                    t.canProvideAlliedHealth.includes(need.type) &&
                    client.insuranceRequirements.every(req => t.qualifications.includes(req))
                );
                
                tasks.push({
                    clientId: client.id,
                    clientName: client.name,
                    type: `AlliedHealth_${need.type}` as SessionType,
                    minDuration: need.durationMinutes,
                    maxDuration: need.durationMinutes,
                    priority: 1000 - (qualified.length * 10) + need.durationMinutes,
                    possibleTherapists: qualified,
                    preferredStart: need.preferredTimeSlot?.startTime ? timeToMinutes(need.preferredTimeSlot.startTime) : undefined,
                    preferredEnd: need.preferredTimeSlot?.endTime ? timeToMinutes(need.preferredTimeSlot.endTime) : undefined,
                });
            }
        });

        // ABA Tasks
        const qualified = therapists.filter(t => client.insuranceRequirements.every(req => t.qualifications.includes(req)));
        if (qualified.length > 0) {
            tasks.push({
                clientId: client.id,
                clientName: client.name,
                type: 'ABA',
                minDuration: 60,
                maxDuration: 180,
                priority: 500 - (qualified.length * 10) + 180,
                possibleTherapists: qualified
            });
        }
    });

    tasks.sort((a, b) => b.priority - a.priority);

    // 3. Greedy Placement
    for (const task of tasks) {
        const candidateTherapists = [...task.possibleTherapists].sort(() => 0.5 - Math.random());
        let placed = false;

        const searchStart = task.preferredStart !== undefined ? task.preferredStart : opStartMins;
        const searchEnd = task.preferredEnd !== undefined ? task.preferredEnd : opEndMins;

        for (const therapist of candidateTherapists) {
            if (placed) break;

            for (let time = searchStart; time <= searchEnd - task.minDuration; time += 15) {
                const minEnd = time + task.minDuration;
                
                if (tracker.isAvailable('therapist', therapist.id, time, minEnd) && 
                    tracker.isAvailable('client', task.clientId, time, minEnd)) {
                    
                    let bestDuration = task.minDuration;
                    
                    // Try expanding for ABA
                    if (task.type === 'ABA') {
                        for (let d = task.minDuration + 15; d <= task.maxDuration; d += 15) {
                            const extendedEnd = time + d;
                            if (extendedEnd > searchEnd) break;
                            
                            if (tracker.isAvailable('therapist', therapist.id, time, extendedEnd) &&
                                tracker.isAvailable('client', task.clientId, time, extendedEnd)) {
                                bestDuration = d;
                            } else {
                                break;
                            }
                        }
                    }

                    // Soft team alignment check
                    const client = getClientById(clients, task.clientId);
                    if (client && client.teamId && therapist.teamId && client.teamId !== therapist.teamId && Math.random() > 0.3) {
                        continue;
                    }

                    const newEntry: ScheduleEntry = {
                        id: generateId(),
                        clientName: task.clientName,
                        clientId: task.clientId,
                        therapistName: therapist.name,
                        therapistId: therapist.id,
                        day,
                        startTime: minutesToTime(time),
                        endTime: minutesToTime(time + bestDuration),
                        sessionType: task.type
                    };

                    // Check for back-to-back same client constraint BEFORE placing
                    const validation = canAddEntryToSchedule(newEntry, schedule, clients, therapists, selectedDate, callouts);
                    if (!validation.valid) {
                        // Check if it's specifically the back-to-back constraint
                        const hasBackToBackViolation = validation.violations.some(v => 
                            v.message.includes('contiguous sessions') || v.message.includes('back-to-back')
                        );
                        if (hasBackToBackViolation) {
                            continue; // Skip this time slot, try next
                        }
                        // For other violations, also skip
                        continue;
                    }

                    schedule.push(newEntry);
                    tracker.book(therapist.id, task.clientId, time, time + bestDuration);
                    placed = true;
                    break;
                }
            }
        }
    }

    // 4. Place Lunches with learned patterns
    const workingTherapistIds = new Set(schedule.map(s => s.therapistId));
    workingTherapistIds.forEach(therapistId => {
        const tSessions = schedule.filter(s => s.therapistId === therapistId);
        const mins = tSessions.reduce((acc, s) => acc + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)), 0);
        if (mins < 300) return;

        if (!schedule.some(s => s.therapistId === therapistId && s.sessionType === 'IndirectTime')) {
            const therapist = getTherapistById(therapists, therapistId)!;
            
            // Try learned lunch times first
            if (learningContext?.learnedLunchTimes) {
                const learnedPattern = learningContext.learnedLunchTimes.find(
                    lt => lt.therapistId === therapistId
                );
                if (learnedPattern) {
                    const learnedStart = timeToMinutes(learnedPattern.startTime);
                    if (tracker.isAvailable('therapist', therapistId, learnedStart, learnedStart + 30)) {
                        schedule.push({
                            id: generateId(),
                            clientName: null,
                            clientId: null,
                            therapistName: therapist.name,
                            therapistId,
                            day,
                            startTime: minutesToTime(learnedStart),
                            endTime: minutesToTime(learnedStart + 30),
                            sessionType: 'IndirectTime'
                        });
                        tracker.book(therapistId, null, learnedStart, learnedStart + 30);
                        return;
                    }
                }
            }
            
            // Fallback to ideal window
            const lunchStart = timeToMinutes(IDEAL_LUNCH_WINDOW_START);
            const lunchEnd = timeToMinutes(IDEAL_LUNCH_WINDOW_END_FOR_START);

            for (let time = lunchStart; time <= lunchEnd; time += 15) {
                if (tracker.isAvailable('therapist', therapistId, time, time + 30)) {
                    schedule.push({
                        id: generateId(),
                        clientName: null,
                        clientId: null,
                        therapistName: therapist.name,
                        therapistId: therapist.id,
                        day,
                        startTime: minutesToTime(time),
                        endTime: minutesToTime(time + 30),
                        sessionType: 'IndirectTime'
                    });
                    tracker.book(therapistId, null, time, time + 30);
                    break;
                }
            }
        }
    });

    return schedule;
}

// --- Incremental Mutation ---
function mutateIncremental(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    if (schedule.length === 0) return schedule;
    
    const newSchedule = cloneSchedule(schedule);
    const numMutations = Math.max(1, Math.floor(newSchedule.length * 0.1));

    for (let m = 0; m < numMutations; m++) {
        const idx = Math.floor(Math.random() * newSchedule.length);
        const entry = newSchedule[idx];

        if (entry.sessionType === 'IndirectTime') continue;

        const action = Math.random();
        
        if (action < 0.5) {
            // SLIDE
            const shift = (Math.floor(Math.random() * 3) - 1) * 15; 
            if (shift === 0) continue;

            const currentStart = timeToMinutes(entry.startTime);
            const currentEnd = timeToMinutes(entry.endTime);
            const duration = currentEnd - currentStart;
            
            const newStart = currentStart + shift;
            const newEnd = newStart + duration;

            const shiftedEntry = {
                ...entry,
                startTime: minutesToTime(newStart),
                endTime: minutesToTime(newEnd)
            };

            const validation = canAddEntryToSchedule(shiftedEntry, newSchedule, clients, therapists, selectedDate, callouts, entry.id);
            if (validation.valid) {
                newSchedule[idx] = shiftedEntry;
            }

        } else {
            // RESIZE (ABA only)
            if (entry.sessionType === 'ABA') {
                const change = (Math.random() < 0.5 ? -15 : 15);
                const currentStart = timeToMinutes(entry.startTime);
                const currentEnd = timeToMinutes(entry.endTime);
                const currentDuration = currentEnd - currentStart;
                const newDuration = currentDuration + change;

                if (newDuration >= 60 && newDuration <= 180) {
                    const resizedEntry = {
                        ...entry,
                        endTime: minutesToTime(currentStart + newDuration)
                    };
                    const validation = canAddEntryToSchedule(resizedEntry, newSchedule, clients, therapists, selectedDate, callouts, entry.id);
                    if (validation.valid) {
                        newSchedule[idx] = resizedEntry;
                    }
                }
            }
        }
    }

    return newSchedule;
}

// --- Repair Functions ---
function cleanupScheduleIssues(schedule: GeneratedSchedule): GeneratedSchedule {
    let merged = true;
    let iterations = 0;
    const MAX_MERGE_ITERATIONS = 50;

    while(merged && iterations < MAX_MERGE_ITERATIONS){
        merged = false;
        iterations++;
        const therapistIds = [...new Set(schedule.map(s => s.therapistId))];
        let newSchedule: GeneratedSchedule = [];
        
        therapistIds.forEach(therapistId => {
            const sessions = schedule.filter(s => s.therapistId === therapistId).sort((a,b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            if(sessions.length <= 1) {
                newSchedule.push(...sessions);
                return;
            }
            let currentSession = {...sessions[0]};
            for(let i = 1; i < sessions.length; i++){
                const nextSession = sessions[i];
                if(currentSession.clientId === nextSession.clientId && 
                   currentSession.sessionType === nextSession.sessionType && 
                   currentSession.endTime === nextSession.startTime &&
                   currentSession.sessionType === 'ABA') { 
                    
                    const combinedDuration = (timeToMinutes(nextSession.endTime) - timeToMinutes(nextSession.startTime)) + 
                                             (timeToMinutes(currentSession.endTime) - timeToMinutes(currentSession.startTime));
                    
                    if (combinedDuration <= 180) {
                        currentSession.endTime = nextSession.endTime;
                        merged = true;
                    } else {
                        newSchedule.push(currentSession);
                        currentSession = {...nextSession};
                    }
                } else {
                    newSchedule.push(currentSession);
                    currentSession = {...nextSession};
                }
            }
            newSchedule.push(currentSession);
        });
        schedule = newSchedule;
    }
    return schedule;
}

function fixSessionDurations(schedule: GeneratedSchedule): GeneratedSchedule {
    const fixedSchedule: GeneratedSchedule = [];
    schedule.forEach(entry => {
        if (entry.sessionType === 'ABA') {
            const start = timeToMinutes(entry.startTime);
            const end = timeToMinutes(entry.endTime);
            let duration = end - start;
            
            if (duration > 180) {
                fixedSchedule.push({ ...entry, endTime: minutesToTime(start + 180) });
            } else if (duration < 60) {
                fixedSchedule.push({ ...entry, endTime: minutesToTime(start + 60) }); 
            } else {
                fixedSchedule.push(entry);
            }
        } else {
            fixedSchedule.push(entry);
        }
    });
    return fixedSchedule;
}

function fixCredentialIssues(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    schedule.forEach(entry => {
        if (!entry.clientId) return;
        const client = getClientById(clients, entry.clientId);
        const therapist = getTherapistById(therapists, entry.therapistId);
        
        if (client && therapist && !client.insuranceRequirements.every(req => therapist.qualifications.includes(req))) {
            const qualifiedTherapists = therapists.filter(t => client.insuranceRequirements.every(req => t.qualifications.includes(req)));
            const replacement = qualifiedTherapists.find(t => 
                canAddEntryToSchedule({ ...entry, therapistId: t.id, therapistName: t.name }, schedule, clients, therapists, selectedDate, callouts, entry.id).valid
            );
            
            if (replacement) {
                entry.therapistId = replacement.id;
                entry.therapistName = replacement.name;
            }
        }
    });
    return schedule;
}

function fixMdMedicaidLimit(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    clients.forEach(client => {
        if (!client.insuranceRequirements.includes("MD_MEDICAID")) return;
        
        const clientSessions = schedule.filter(s => s.clientId === client.id);
        const uniqueTherapists = [...new Set(clientSessions.map(s => s.therapistId))];
        
        if (uniqueTherapists.length > 3) {
            const allowedIds = uniqueTherapists.slice(0, 3);
            clientSessions.forEach(session => {
                if (!allowedIds.includes(session.therapistId)) {
                    const bestSub = allowedIds.find(tid => {
                        const t = getTherapistById(therapists, tid);
                        if (!t) return false;
                        const testEntry = { ...session, therapistId: t.id, therapistName: t.name };
                        return canAddEntryToSchedule(testEntry, schedule, clients, therapists, selectedDate, callouts, session.id).valid;
                    });
                    
                    if (bestSub) {
                        const t = getTherapistById(therapists, bestSub)!;
                        session.therapistId = t.id;
                        session.therapistName = t.name;
                    } else {
                        const idx = schedule.findIndex(s => s.id === session.id);
                        if (idx > -1) schedule.splice(idx, 1);
                    }
                }
            });
        }
    });
    return schedule;
}

function fixLunchIssues(schedule: GeneratedSchedule, therapists: Therapist[], day: DayOfWeek, selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    const tracker = new AvailabilityTracker(schedule, callouts, selectedDate);
    const workingTherapistIds = new Set(schedule.filter(s => s.sessionType !== 'IndirectTime').map(s => s.therapistId));
    
    workingTherapistIds.forEach(therapistId => {
        const therapistSessions = schedule.filter(s => s.therapistId === therapistId && s.sessionType !== 'IndirectTime');
        const totalMinutes = therapistSessions.reduce((acc, s) => acc + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)), 0);
        if (totalMinutes < 300) return;

        const hasLunch = schedule.some(s => s.therapistId === therapistId && s.sessionType === 'IndirectTime');
        if(!hasLunch) {
            const therapist = getTherapistById(therapists, therapistId)!;
            
            // Get all sessions sorted by time
            const allSessions = schedule
                .filter(s => s.therapistId === therapistId)
                .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            
            if (allSessions.length === 0) return;
            
            // Calculate workday boundaries
            const workdayStart = timeToMinutes(allSessions[0].startTime);
            const workdayEnd = timeToMinutes(allSessions[allSessions.length - 1].endTime);
            const workdayMidpoint = workdayStart + (workdayEnd - workdayStart) / 2;
            
            // Get clients this therapist works with
            const therapistClients = new Set(
                allSessions
                    .filter(s => s.clientId)
                    .map(s => s.clientId!)
            );
            
            // Score potential lunch times
            interface LunchCandidate {
                time: number;
                score: number;
                reason: string;
            }
            
            const candidates: LunchCandidate[] = [];
            const lunchDuration = 30;
            const searchStart = Math.max(
                timeToMinutes(LUNCH_COVERAGE_START_TIME),
                workdayStart
            );
            const searchEnd = Math.min(
                timeToMinutes(LUNCH_COVERAGE_END_TIME) - lunchDuration,
                workdayEnd - lunchDuration
            );
            
            // Evaluate each potential lunch time
            for (let time = searchStart; time <= searchEnd; time += 15) {
                if (!tracker.isAvailable('therapist', therapistId, time, time + lunchDuration)) {
                    continue;
                }
                
                let score = 0;
                const reasons: string[] = [];
                
                // 1. Proximity to workday midpoint (higher score = better)
                const distanceFromMidpoint = Math.abs(time - workdayMidpoint);
                const maxDistance = (workdayEnd - workdayStart) / 2;
                const midpointScore = 100 * (1 - Math.min(distanceFromMidpoint / maxDistance, 1));
                score += midpointScore;
                if (midpointScore > 50) reasons.push('near-midpoint');
                
                // 2. Natural gap in schedule (prefer existing gaps)
                const gapBefore = allSessions.length > 0 ? 
                    allSessions.reduce((minGap, s) => {
                        const sessionEnd = timeToMinutes(s.endTime);
                        if (sessionEnd <= time) {
                            const gap = time - sessionEnd;
                            return Math.min(minGap, gap);
                        }
                        return minGap;
                    }, Infinity) : 0;
                
                const gapAfter = allSessions.length > 0 ?
                    allSessions.reduce((minGap, s) => {
                        const sessionStart = timeToMinutes(s.startTime);
                        if (sessionStart >= time + lunchDuration) {
                            const gap = sessionStart - (time + lunchDuration);
                            return Math.min(minGap, gap);
                        }
                        return minGap;
                    }, Infinity) : 0;
                
                // Prefer times with natural gaps (30+ minutes)
                if (gapBefore >= 30 || gapAfter >= 30) {
                    score += 50;
                    reasons.push('natural-gap');
                } else if (gapBefore >= 15 || gapAfter >= 15) {
                    score += 25;
                }
                
                // 3. Client coverage check (prefer times when clients have other therapists available)
                // This is a soft preference - we check if the therapist's clients have other therapists
                // scheduled during the lunch window, which suggests good coverage
                let coverageScore = 0;
                let clientsWithCoverage = 0;
                
                for (const clientId of therapistClients) {
                    // Check if other therapists are scheduled with this client during lunch window
                    const otherTherapistsCovering = schedule.filter(s => 
                        s.clientId === clientId &&
                        s.therapistId !== therapistId &&
                        s.sessionType !== 'IndirectTime' &&
                        timeToMinutes(s.startTime) < time + lunchDuration &&
                        timeToMinutes(s.endTime) > time
                    ).length;
                    
                    if (otherTherapistsCovering > 0) {
                        clientsWithCoverage++;
                        coverageScore += 20; // Bonus for each client with coverage
                    }
                }
                
                if (clientsWithCoverage > 0 && therapistClients.size > 0) {
                    const coverageRatio = clientsWithCoverage / therapistClients.size;
                    score += coverageScore * coverageRatio;
                    if (coverageRatio > 0.5) reasons.push('good-coverage');
                }
                
                // 4. Workload balance (prefer times that split work evenly)
                const workBefore = allSessions
                    .filter(s => timeToMinutes(s.endTime) <= time)
                    .reduce((sum, s) => sum + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)), 0);
                
                const workAfter = allSessions
                    .filter(s => timeToMinutes(s.startTime) >= time + lunchDuration)
                    .reduce((sum, s) => sum + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)), 0);
                
                const totalWork = workBefore + workAfter;
                if (totalWork > 0) {
                    const balanceRatio = Math.min(workBefore, workAfter) / Math.max(workBefore, workAfter);
                    score += balanceRatio * 40; // Up to 40 points for balanced workload
                    if (balanceRatio > 0.7) reasons.push('balanced-workload');
                }
                
                // 5. Team coordination (avoid too many team members on lunch at once)
                if (therapist.teamId) {
                    const teamMembers = therapists.filter(t => t.teamId === therapist.teamId);
                    const teammatesOnLunch = teamMembers.filter(t => 
                        t.id !== therapistId &&
                        schedule.some(s =>
                            s.therapistId === t.id &&
                            s.sessionType === 'IndirectTime' &&
                            timeToMinutes(s.startTime) < time + lunchDuration &&
                            timeToMinutes(s.endTime) > time
                        )
                    ).length;
                    
                    // Prefer times when fewer teammates are on lunch
                    const teamRatio = teammatesOnLunch / Math.max(teamMembers.length - 1, 1);
                    if (teamRatio < 0.5) {
                        score += 30;
                        reasons.push('team-staggered');
                    } else if (teamRatio > 0.7) {
                        score -= 30; // Penalty if too many teammates on lunch
                        reasons.push('team-crowded');
                    }
                }
                
                // 6. Prefer times within ideal window
                if (time >= timeToMinutes(IDEAL_LUNCH_WINDOW_START) && 
                    time <= timeToMinutes(IDEAL_LUNCH_WINDOW_END_FOR_START)) {
                    score += 20;
                    reasons.push('ideal-window');
                }
                
                candidates.push({
                    time,
                    score,
                    reason: reasons.join(', ')
                });
            }
            
            // Sort by score (highest first) and try the best candidates
            candidates.sort((a, b) => b.score - a.score);
            
            for (const candidate of candidates.slice(0, 5)) { // Try top 5 candidates
                if (tracker.isAvailable('therapist', therapistId, candidate.time, candidate.time + lunchDuration)) {
                    schedule.push({ 
                        id: generateId(), 
                        clientName: null, 
                        clientId: null, 
                        therapistName: therapist.name, 
                        therapistId, 
                        day, 
                        startTime: minutesToTime(candidate.time), 
                        endTime: minutesToTime(candidate.time + lunchDuration), 
                        sessionType: 'IndirectTime' 
                    });
                    return;
                }
            }
            
            // Fallback: Try to split a long session to create break space
            const longSessions = schedule
                .filter(s => s.therapistId === therapistId && s.sessionType === 'ABA' && 
                        (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)) >= 90)
                .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            
            for (const session of longSessions) {
                const sessionStart = timeToMinutes(session.startTime);
                const sessionEnd = timeToMinutes(session.endTime);
                
                // Try to split session after 60-90 minutes, near workday midpoint if possible
                const preferredSplitTime = Math.max(
                    sessionStart + 60,
                    Math.min(sessionEnd - 60, workdayMidpoint)
                );
                
                for (let splitTime = preferredSplitTime; 
                     splitTime <= Math.min(sessionEnd - 60, timeToMinutes(LUNCH_COVERAGE_END_TIME) - 30); 
                     splitTime += 15) {
                    
                    if (tracker.isAvailable('therapist', therapistId, splitTime, splitTime + 30, session.id)) {
                        const originalEnd = session.endTime;
                        session.endTime = minutesToTime(splitTime);
                        
                        schedule.push({ 
                            id: generateId(), 
                            clientName: null, 
                            clientId: null, 
                            therapistName: therapist.name, 
                            therapistId, 
                            day, 
                            startTime: minutesToTime(splitTime), 
                            endTime: minutesToTime(splitTime + 30), 
                            sessionType: 'IndirectTime' 
                        });

                        schedule.push({ 
                            id: generateId(), 
                            clientName: session.clientName, 
                            clientId: session.clientId, 
                            therapistName: session.therapistName, 
                            therapistId: session.therapistId, 
                            day, 
                            startTime: minutesToTime(splitTime + 30), 
                            endTime: originalEnd, 
                            sessionType: 'ABA' 
                        });
                        return;
                    }
                }
                
                // Also try before preferred time
                for (let splitTime = Math.max(sessionStart + 60, timeToMinutes(LUNCH_COVERAGE_START_TIME)); 
                     splitTime < preferredSplitTime; 
                     splitTime += 15) {
                    
                    if (tracker.isAvailable('therapist', therapistId, splitTime, splitTime + 30, session.id)) {
                        const originalEnd = session.endTime;
                        session.endTime = minutesToTime(splitTime);
                        
                        schedule.push({ 
                            id: generateId(), 
                            clientName: null, 
                            clientId: null, 
                            therapistName: therapist.name, 
                            therapistId, 
                            day, 
                            startTime: minutesToTime(splitTime), 
                            endTime: minutesToTime(splitTime + 30), 
                            sessionType: 'IndirectTime' 
                        });

                        schedule.push({ 
                            id: generateId(), 
                            clientName: session.clientName, 
                            clientId: session.clientId, 
                            therapistName: session.therapistName, 
                            therapistId: session.therapistId, 
                            day, 
                            startTime: minutesToTime(splitTime + 30), 
                            endTime: originalEnd, 
                            sessionType: 'ABA' 
                        });
                        return;
                    }
                }
            }
        }
    });
    return schedule;
}

function fixClientCoverageGaps(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], day: DayOfWeek, selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    const tracker = new AvailabilityTracker(schedule, callouts, selectedDate);

    clients.forEach(client => {
        const gaps = getClientCoverageGaps(schedule, client.id, callouts, selectedDate);
        const qualifiedTherapists = therapists.filter(t => client.insuranceRequirements.every(req => t.qualifications.includes(req)));
        
        gaps.forEach(gap => {
            if (gap.end - gap.start < 60) return;
            const maxLen = Math.min(180, gap.end - gap.start);
            
            for (let len = maxLen; len >= 60; len -= 15) {
                const start = gap.start;
                const end = gap.start + len;

                const availableTherapist = qualifiedTherapists.find(t => {
                    return tracker.isAvailable('therapist', t.id, start, end);
                });

                if (availableTherapist) {
                    const candidateEntry: ScheduleEntry = {
                        id: generateId(),
                        clientName: client.name,
                        clientId: client.id,
                        therapistName: availableTherapist.name,
                        therapistId: availableTherapist.id,
                        day: day,
                        startTime: minutesToTime(start),
                        endTime: minutesToTime(end),
                        sessionType: 'ABA'
                    };
                    schedule.push(candidateEntry);
                    tracker.book(availableTherapist.id, client.id, start, end);
                    break; 
                }
            }
        });
    });
    return schedule;
}

function fixSameClientBackToBackIssues(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], day: DayOfWeek, selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    const fixedSchedule: GeneratedSchedule = [];
    const therapistSessions = new Map<string, ScheduleEntry[]>();
    
    // Separate client sessions from non-client sessions
    const nonClientSessions: ScheduleEntry[] = [];
    
    schedule.forEach(entry => {
        if (!entry.clientId) {
            nonClientSessions.push(entry);
            return;
        }
        
        if (!therapistSessions.has(entry.therapistId)) {
            therapistSessions.set(entry.therapistId, []);
        }
        therapistSessions.get(entry.therapistId)!.push(entry);
    });
    
    // Process each therapist's sessions
    therapistSessions.forEach((sessions, therapistId) => {
        // Sort by start time
        sessions.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        
        for (let i = 0; i < sessions.length; i++) {
            const current = sessions[i];
            const prev = i > 0 ? sessions[i - 1] : null;
            
            // Check if this session is back-to-back with same client
            if (prev && 
                prev.clientId === current.clientId &&
                prev.endTime === current.startTime) {
                
                // Try to insert a gap by moving current session later
                const prevEnd = timeToMinutes(prev.endTime);
                const currentStart = timeToMinutes(current.startTime);
                const duration = timeToMinutes(current.endTime) - currentStart;
                
                // Try to place it 15 minutes later
                const newStart = prevEnd + 15;
                const newEnd = newStart + duration;
                
                // Check if new time is within operating hours
                if (newEnd <= timeToMinutes(COMPANY_OPERATING_HOURS_END)) {
                    // Check if the new time slot is available
                    const wouldConflict = fixedSchedule.some(s => 
                        s.therapistId === therapistId &&
                        s.day === day &&
                        sessionsOverlap(s.startTime, s.endTime, minutesToTime(newStart), minutesToTime(newEnd))
                    ) || fixedSchedule.some(s =>
                        s.clientId === current.clientId &&
                        s.day === day &&
                        sessionsOverlap(s.startTime, s.endTime, minutesToTime(newStart), minutesToTime(newEnd))
                    );
                    
                    if (!wouldConflict) {
                        // Move the session
                        const adjustedEntry = {
                            ...current,
                            startTime: minutesToTime(newStart),
                            endTime: minutesToTime(newEnd)
                        };
                        fixedSchedule.push(adjustedEntry);
                        continue;
                    }
                }
                
                // If we can't move it later, try moving previous earlier
                const prevStart = timeToMinutes(prev.startTime);
                const prevDuration = prevEnd - prevStart;
                const newPrevEnd = currentStart - 15;
                const newPrevStart = newPrevEnd - prevDuration;
                
                if (newPrevStart >= timeToMinutes(COMPANY_OPERATING_HOURS_START)) {
                    const wouldConflict = fixedSchedule.some(s => 
                        (s.therapistId === therapistId || s.clientId === prev.clientId) &&
                        s.day === day &&
                        s.id !== prev.id &&
                        sessionsOverlap(s.startTime, s.endTime, minutesToTime(newPrevStart), minutesToTime(newPrevEnd))
                    );
                    
                    if (!wouldConflict) {
                        // Update previous session in fixedSchedule if it's already there
                        const prevIndex = fixedSchedule.findIndex(e => e.id === prev.id);
                        if (prevIndex >= 0) {
                            fixedSchedule[prevIndex] = {
                                ...prev,
                                startTime: minutesToTime(newPrevStart),
                                endTime: minutesToTime(newPrevEnd)
                            };
                        } else {
                            fixedSchedule.push({
                                ...prev,
                                startTime: minutesToTime(newPrevStart),
                                endTime: minutesToTime(newPrevEnd)
                            });
                        }
                        fixedSchedule.push(current);
                        continue;
                    }
                }
                
                // Last resort: skip the current session (it will be removed)
                continue;
            }
            
            // No violation, add as-is
            fixedSchedule.push(current);
        }
    });
    
    // Add back non-client sessions
    fixedSchedule.push(...nonClientSessions);
    
    return fixedSchedule;
}

function fixTeamAlignmentIssues(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[]): GeneratedSchedule {
    schedule.forEach(entry => {
        if (!entry.clientId) return;
        const client = getClientById(clients, entry.clientId);
        const therapist = getTherapistById(therapists, entry.therapistId);
        
        if (client && therapist && client.teamId && therapist.teamId && client.teamId !== therapist.teamId) {
            const teamMates = therapists.filter(t => t.teamId === client.teamId && client.insuranceRequirements.every(r => t.qualifications.includes(r)));
            
            const replacement = teamMates.find(t => {
                const testEntry = { ...entry, therapistId: t.id, therapistName: t.name };
                return canAddEntryToSchedule(testEntry, schedule, clients, therapists, new Date(), [], entry.id).valid;
            });
            
            if (replacement) {
                entry.therapistId = replacement.id;
                entry.therapistName = replacement.name;
            }
        }
    });
    return schedule;
}

function repairAndMutate(schedule: GeneratedSchedule, clients: Client[], therapists: Therapist[], day: DayOfWeek, selectedDate: Date, callouts: Callout[], baseScheduleForDay?: BaseScheduleConfig | null): GeneratedSchedule {
    let modifiedSchedule = cloneSchedule(schedule);

    if (Math.random() < MUTATION_RATE) {
        modifiedSchedule = mutateIncremental(modifiedSchedule, clients, therapists, selectedDate, callouts);
    }

    modifiedSchedule = cleanupScheduleIssues(modifiedSchedule);
    modifiedSchedule = fixSessionDurations(modifiedSchedule);
    modifiedSchedule = fixCredentialIssues(modifiedSchedule, clients, therapists, selectedDate, callouts);
    modifiedSchedule = fixMdMedicaidLimit(modifiedSchedule, clients, therapists, selectedDate, callouts);
    modifiedSchedule = fixSameClientBackToBackIssues(modifiedSchedule, clients, therapists, day, selectedDate, callouts);
    modifiedSchedule = fixClientCoverageGaps(modifiedSchedule, clients, therapists, day, selectedDate, callouts);
    modifiedSchedule = fixLunchIssues(modifiedSchedule, therapists, day, selectedDate, callouts);
    modifiedSchedule = fixTeamAlignmentIssues(modifiedSchedule, clients, therapists);

    return modifiedSchedule;
}

// --- Local Search ---
function localSearchImprovement(
    schedule: GeneratedSchedule,
    clients: Client[],
    therapists: Therapist[],
    selectedDate: Date,
    callouts: Callout[],
    maxIterations: number = 30
): GeneratedSchedule {
    let currentSchedule = cloneSchedule(schedule);
    let currentFitness = calculateFitness(currentSchedule, clients, therapists, selectedDate, callouts);
    
    for (let iter = 0; iter < maxIterations; iter++) {
        let improved = false;
        
        for (let i = 0; i < currentSchedule.length; i++) {
            for (let j = i + 1; j < currentSchedule.length; j++) {
                const entry1 = currentSchedule[i];
                const entry2 = currentSchedule[j];
                
                if (entry1.clientId && entry2.clientId && 
                    entry1.therapistId !== entry2.therapistId) {
                    
                    const testSchedule = cloneSchedule(currentSchedule);
                    const temp = testSchedule[i].therapistId;
                    testSchedule[i].therapistId = testSchedule[j].therapistId;
                    testSchedule[i].therapistName = getTherapistById(therapists, testSchedule[j].therapistId)!.name;
                    testSchedule[j].therapistId = temp;
                    testSchedule[j].therapistName = getTherapistById(therapists, temp)!.name;
                    
                    const testFitness = calculateFitness(testSchedule, clients, therapists, selectedDate, callouts);
                    
                    if (testFitness < currentFitness) {
                        currentSchedule = testSchedule;
                        currentFitness = testFitness;
                        improved = true;
                        break;
                    }
                }
            }
            if (improved) break;
        }
        
        if (!improved) break;
    }
    
    return currentSchedule;
}

// --- GA Core Loop ---
function diversityPreservingSelection(
    population: {schedule: GeneratedSchedule, fitness: number}[]
): GeneratedSchedule {
    const similarityCheck = Math.random();
    if (similarityCheck < 0.3) {
        const randomIdx = Math.floor(Math.random() * population.length);
        return cloneSchedule(population[randomIdx].schedule);
    }
    
    const tournamentSize = 5;
    let best = null;
    for (let i = 0; i < tournamentSize; i++) {
        const idx = Math.floor(Math.random() * population.length);
        const candidate = population[idx];
        if (!best || candidate.fitness < best.fitness) {
            best = candidate;
        }
    }
    return cloneSchedule(best!.schedule);
}

function crossover(parent1: GeneratedSchedule, parent2: GeneratedSchedule, therapists: Therapist[], clients: Client[], selectedDate: Date, callouts: Callout[]): GeneratedSchedule {
    if (Math.random() > CROSSOVER_RATE) return cloneSchedule(Math.random() < 0.5 ? parent1 : parent2);
    
    const offspring: GeneratedSchedule = [];
    const therapistIds = therapists.map(t => t.id);
    const midpoint = Math.floor(therapistIds.length / 2);
    const p1Ids = new Set(therapistIds.slice(0, midpoint));

    parent1.forEach(s => { if (p1Ids.has(s.therapistId)) offspring.push({ ...s, id: generateId() }); });
    parent2.forEach(s => { if (!p1Ids.has(s.therapistId)) offspring.push({ ...s, id: generateId() }); });

    // Immediate conflict resolution
    offspring.sort((a, b) => {
        const aTherapist = getTherapistById(therapists, a.therapistId);
        const bTherapist = getTherapistById(therapists, b.therapistId);
        const aBCBA = aTherapist?.qualifications.includes("BCBA") ? 0 : 1;
        const bBCBA = bTherapist?.qualifications.includes("BCBA") ? 0 : 1;
        if (aBCBA !== bBCBA) return aBCBA - bBCBA;
        return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    const validOffspring: GeneratedSchedule = [];
    const tracker = new AvailabilityTracker([], callouts, selectedDate);

    offspring.forEach(entry => {
        const start = timeToMinutes(entry.startTime);
        const end = timeToMinutes(entry.endTime);
        
        const tAvail = tracker.isAvailable('therapist', entry.therapistId, start, end);
        const cAvail = !entry.clientId || tracker.isAvailable('client', entry.clientId, start, end);
        
        if (tAvail && cAvail) {
            validOffspring.push(entry);
            tracker.book(entry.therapistId, entry.clientId, start, end);
        }
    });

    return validOffspring;
}

// --- Main Algorithm ---
export async function runCsoAlgorithm(
    clients: Client[],
    therapists: Therapist[],
    selectedDate: Date,
    callouts: Callout[],
    initialScheduleForOptimization?: GeneratedSchedule
): Promise<GAGenerationResult> {
    const day = getDayOfWeekFromDate(selectedDate);
    const baseScheduleForDay = initialScheduleForOptimization ? null : baseScheduleService.getBaseSchedules().find(bs => bs.appliesToDays.includes(day));
    
    const learningContext = await loadLearningContext();

    // Init Population
    let population: GeneratedSchedule[] = [];
    
    if (initialScheduleForOptimization) {
        population.push(repairAndMutate(initialScheduleForOptimization, clients, therapists, day, selectedDate, callouts));
    } else if (baseScheduleForDay?.schedule) {
        population.push(repairAndMutate(baseScheduleForDay.schedule, clients, therapists, day, selectedDate, callouts));
    }

    // Seed high-rated schedules
    for (const topSchedule of learningContext.topRatedSchedules.slice(0, 5)) {
        const topScheduleForDay = topSchedule.filter(s => s.day === day).map(e => ({...e, id: generateId()}));
        if (topScheduleForDay.length > 0) {
            population.push(topScheduleForDay);
        }
        if (population.length >= POPULATION_SIZE * 0.2) break;
    }

    // Fill with constructive heuristic
    while (population.length < POPULATION_SIZE) {
        population.push(constructiveHeuristicInitialization(clients, therapists, day, selectedDate, callouts, baseScheduleForDay, learningContext));
    }

    let bestFitnessOverall = Infinity;
    let bestScheduleOverall: GeneratedSchedule | null = null;
    let generationsRun = 0;
    let generationsWithoutImprovement = 0;

    for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
        generationsRun = gen + 1;

        const popWithFitness = population.map(p => ({
            schedule: p,
            fitness: calculateFitness(p, clients, therapists, selectedDate, callouts)
        }));

        popWithFitness.sort((a,b) => a.fitness - b.fitness);
        
        if (popWithFitness[0].fitness < bestFitnessOverall) {
            bestFitnessOverall = popWithFitness[0].fitness;
            bestScheduleOverall = cloneSchedule(popWithFitness[0].schedule);
            generationsWithoutImprovement = 0;
        } else {
            generationsWithoutImprovement++;
        }

        if (bestFitnessOverall === 0) break;
        
        if (generationsWithoutImprovement >= PLATEAU_LIMIT) {
            console.log(`Early termination: plateau detected after ${PLATEAU_LIMIT} generations`);
            break;
        }

        // Evolution
        const newPop: GeneratedSchedule[] = [];
        const eliteCount = Math.floor(POPULATION_SIZE * ELITISM_RATE);
        for(let i=0; i<eliteCount; i++) newPop.push(cloneSchedule(popWithFitness[i].schedule));

        while(newPop.length < POPULATION_SIZE) {
            const p1 = diversityPreservingSelection(popWithFitness);
            const p2 = diversityPreservingSelection(popWithFitness);
            let child = crossover(p1, p2, therapists, clients, selectedDate, callouts);
            child = repairAndMutate(child, clients, therapists, day, selectedDate, callouts);
            newPop.push(child);
        }
        population = newPop;
    }

    // Apply local search
    if (bestScheduleOverall) {
        bestScheduleOverall = localSearchImprovement(
            bestScheduleOverall,
            clients,
            therapists,
            selectedDate,
            callouts,
            30
        );
        bestFitnessOverall = calculateFitness(
            bestScheduleOverall,
            clients,
            therapists,
            selectedDate,
            callouts
        );
    }

    const finalCleaned = bestScheduleOverall ? cleanupScheduleIssues(bestScheduleOverall) : [];
    const finalErrors = validateFullSchedule(finalCleaned, clients, therapists, selectedDate, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, callouts);

    return {
        schedule: finalCleaned,
        finalValidationErrors: finalErrors,
        generations: generationsRun,
        bestFitness: bestFitnessOverall,
        success: bestFitnessOverall < 500,
        statusMessage: `Optimization Complete: ${generationsRun} generations. Best Fitness: ${bestFitnessOverall.toFixed(0)}`
    };
}

// --- Fitness Calculation ---
function calculateFitness(
    schedule: GeneratedSchedule,
    clients: Client[],
    therapists: Therapist[],
    selectedDate: Date,
    callouts: Callout[]
): number {
    const penalties = calculateAdaptivePenalties(clients, therapists, schedule);
    let fitness = 0;
    const errors = validateFullSchedule(schedule, clients, therapists, selectedDate, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, callouts);

    const counts: Record<string, number> = {};
    errors.forEach(e => counts[e.ruleId] = (counts[e.ruleId] || 0) + 1);

    if (counts["CLIENT_TIME_CONFLICT"]) fitness += penalties.CONFLICT_PENALTY * Math.min(counts["CLIENT_TIME_CONFLICT"], 5);
    if (counts["THERAPIST_TIME_CONFLICT"]) fitness += penalties.CONFLICT_PENALTY * Math.min(counts["THERAPIST_TIME_CONFLICT"], 5);
    if (counts["SAME_CLIENT_BACK_TO_BACK"]) fitness += penalties.SAME_CLIENT_BACK_TO_BACK_PENALTY * counts["SAME_CLIENT_BACK_TO_BACK"];
    if (counts["INSURANCE_MISMATCH"]) fitness += penalties.CREDENTIAL_MISMATCH_PENALTY * Math.min(counts["INSURANCE_MISMATCH"], 5);
    if (counts["SESSION_OVERLAPS_CALLOUT"]) fitness += penalties.CALLOUT_OVERLAP_PENALTY * Math.min(counts["SESSION_OVERLAPS_CALLOUT"], 5);
    
    if (counts["MISSING_LUNCH_BREAK"]) fitness += penalties.MISSING_LUNCH_PENALTY * Math.min(counts["MISSING_LUNCH_BREAK"], therapists.length);
    if (counts["LUNCH_OUTSIDE_WINDOW"]) fitness += penalties.LUNCH_OUTSIDE_WINDOW_PENALTY * counts["LUNCH_OUTSIDE_WINDOW"];
    
    const lunchViolations = countStaggerViolations(schedule, therapists);
    fitness += penalties.LUNCH_STAGGER_PENALTY * lunchViolations;

    if (counts["ABA_DURATION_TOO_SHORT"]) fitness += penalties.SESSION_DURATION_PENALTY * counts["ABA_DURATION_TOO_SHORT"];
    if (counts["ABA_DURATION_TOO_LONG"]) fitness += penalties.SESSION_DURATION_PENALTY * counts["ABA_DURATION_TOO_LONG"];

    if (counts["MD_MEDICAID_LIMIT_VIOLATED"]) fitness += penalties.MD_MEDICAID_LIMIT_PENALTY * counts["MD_MEDICAID_LIMIT_VIOLATED"];
    
    if (counts["CLIENT_COVERAGE_GAP_AT_TIME"]) {
        const gapPenalty = Math.floor(counts["CLIENT_COVERAGE_GAP_AT_TIME"] / 4);
        fitness += penalties.CLIENT_COVERAGE_GAP_PENALTY * Math.min(gapPenalty, clients.length * 2);
    }

    fitness += calculateFragmentationPenalty(schedule, therapists, penalties.SCHEDULE_FRAGMENTATION_PENALTY);

    if (counts["TEAM_ALIGNMENT_MISMATCH"]) fitness += penalties.TEAM_ALIGNMENT_PENALTY * counts["TEAM_ALIGNMENT_MISMATCH"];
    
    return fitness;
}

function countStaggerViolations(schedule: GeneratedSchedule, therapists: Therapist[]): number {
    let violations = 0;
    const teamLunches = new Map<string, number[]>();

    schedule.filter(s => s.sessionType === 'IndirectTime').forEach(s => {
        const t = getTherapistById(therapists, s.therapistId);
        if (t && t.teamId) {
            const start = timeToMinutes(s.startTime);
            const teamTimes = teamLunches.get(t.teamId) || [];
            
            const overlaps = teamTimes.filter(existing => Math.abs(existing - start) < 30).length;
            if (overlaps >= 1) { 
                violations++;
            }
            
            teamTimes.push(start);
            teamLunches.set(t.teamId, teamTimes);
        }
    });
    return violations;
}

function calculateFragmentationPenalty(schedule: GeneratedSchedule, therapists: Therapist[], penaltyWeight: number): number {
    let totalIdleMinutes = 0;
    
    therapists.forEach(t => {
        const sessions = schedule
            .filter(s => s.therapistId === t.id)
            .sort((a,b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            
        if (sessions.length > 1) {
            for(let i=0; i<sessions.length - 1; i++) {
                const endCurrent = timeToMinutes(sessions[i].endTime);
                const startNext = timeToMinutes(sessions[i+1].startTime);
                const gap = startNext - endCurrent;
                
                if (gap > 0 && gap !== 30) {
                    totalIdleMinutes += gap;
                }
            }
        }
    });
    
    return totalIdleMinutes * penaltyWeight;
}