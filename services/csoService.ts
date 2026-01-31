import { Client, Therapist, GeneratedSchedule, DayOfWeek, Callout, GAGenerationResult, ScheduleEntry, SessionType } from '../types';
import { COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, IDEAL_LUNCH_WINDOW_START, IDEAL_LUNCH_WINDOW_END_FOR_START } from '../constants';
import { validateFullSchedule, timeToMinutes, minutesToTime, sessionsOverlap, isDateAffectedByCalloutRange } from '../utils/validationService';

const SLOT_SIZE = 15;
const OP_START = timeToMinutes(COMPANY_OPERATING_HOURS_START);
const OP_END = timeToMinutes(COMPANY_OPERATING_HOURS_END);
const NUM_SLOTS = (OP_END - OP_START) / SLOT_SIZE;

const generateId = () => `cso-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const getDayOfWeekFromDate = (date: Date): DayOfWeek => {
    const days: DayOfWeek[] = [DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY];
    return days[date.getDay()];
};

class BitTracker {
    public tBusy: bigint[];
    public cBusy: bigint[];
    public cT: Set<number>[];
    constructor(numT: number, numC: number) {
        this.tBusy = new Array(numT).fill(0n);
        this.cBusy = new Array(numC).fill(0n);
        this.cT = new Array(numC).fill(null).map(() => new Set());
    }
    public isTFree(ti: number, s: number, l: number) {
        const m = ((1n << BigInt(l)) - 1n) << BigInt(s);
        return (this.tBusy[ti] & m) === 0n;
    }
    public isCFree(ci: number, s: number, l: number) {
        const m = ((1n << BigInt(l)) - 1n) << BigInt(s);
        return (this.cBusy[ci] & m) === 0n;
    }
    public book(ti: number, ci: number, s: number, l: number) {
        const m = ((1n << BigInt(l)) - 1n) << BigInt(s);
        this.tBusy[ti] |= m;
        if (ci >= 0) { this.cBusy[ci] |= m; this.cT[ci].add(ti); }
    }
}

class FastScheduler {
    private clients: Client[];
    private therapists: Therapist[];
    private day: DayOfWeek;
    private selectedDate: Date;
    private callouts: Callout[];

    constructor(clients: Client[], therapists: Therapist[], day: DayOfWeek, selectedDate: Date, callouts: Callout[]) {
        this.clients = clients;
        this.therapists = therapists;
        this.day = day;
        this.selectedDate = selectedDate;
        this.callouts = callouts;
    }

    private meetsInsurance(t: Therapist, c: Client) {
        return c.insuranceRequirements.every(r => t.qualifications.includes(r));
    }

    public createSchedule(initialSchedule?: GeneratedSchedule): GeneratedSchedule {
        const schedule: GeneratedSchedule = [];
        const tracker = new BitTracker(this.therapists.length, this.clients.length);
        const lunchCount = new Array(NUM_SLOTS).fill(0);
        // Allow enough concurrent lunches to ensure remaining staff can cover all clients
        const maxConcurrentLunches = Math.max(1, this.therapists.length - this.clients.length);
        const tSessionCount = new Array(this.therapists.length).fill(0);

        this.callouts.forEach(co => {
            if (isDateAffectedByCalloutRange(this.selectedDate, co.startDate, co.endDate)) {
                const s = Math.max(0, Math.floor((timeToMinutes(co.startTime) - OP_START) / SLOT_SIZE));
                const e = Math.min(NUM_SLOTS, Math.ceil((timeToMinutes(co.endTime) - OP_START) / SLOT_SIZE));
                if (co.entityType === 'therapist') {
                    const idx = this.therapists.findIndex(t => t.id === co.entityId);
                    if (idx >= 0) tracker.tBusy[idx] |= ((1n << BigInt(e - s)) - 1n) << BigInt(s);
                } else {
                    const idx = this.clients.findIndex(c => c.id === co.entityId);
                    if (idx >= 0) tracker.cBusy[idx] |= ((1n << BigInt(e - s)) - 1n) << BigInt(s);
                }
            }
        });

        if (initialSchedule) {
            initialSchedule.forEach(entry => {
                if (entry.day !== this.day) return;
                const ti = this.therapists.findIndex(t => t.id === entry.therapistId);
                const ci = this.clients.findIndex(c => c.id === entry.clientId);
                const s = Math.max(0, Math.floor((timeToMinutes(entry.startTime) - OP_START) / SLOT_SIZE));
                const l = Math.ceil((timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime)) / SLOT_SIZE);
                if (ti >= 0 && (ci >= 0 || entry.clientId === null) && tracker.isTFree(ti, s, l) && (ci < 0 || tracker.isCFree(ci, s, l))) {
                    if (ci >= 0 && !this.meetsInsurance(this.therapists[ti], this.clients[ci])) return;
                    schedule.push({ ...entry, id: generateId() });
                    tracker.book(ti, ci, s, l);
                    if (entry.sessionType === 'ABA' || entry.sessionType.startsWith('AlliedHealth_')) tSessionCount[ti]++;
                }
            });
        }

        // Optimization: Pre-sort therapists by role once
        const ROLE_RANK: Record<string, number> = { "BCBA": 0, "CF": 1, "STAR 3": 2, "STAR 2": 3, "STAR 1": 4, "RBT": 5, "BT": 6, "Other": 7 };
        const sortedTherapists = this.therapists.map((t, ti) => ({t, ti})).sort((a, b) => {
            return (ROLE_RANK[a.t.role] || 0) - (ROLE_RANK[b.t.role] || 0);
        });

        // Pass 1: Lunches
        const shuffledT = this.therapists.map((t, ti) => ({t, ti})).sort(() => Math.random() - 0.5);
        shuffledT.forEach(q => {
            const ls = Math.floor((timeToMinutes(IDEAL_LUNCH_WINDOW_START) - OP_START) / SLOT_SIZE);
            const le = Math.floor((timeToMinutes(IDEAL_LUNCH_WINDOW_END_FOR_START) - OP_START) / SLOT_SIZE);
            const opts = [];
            for (let s = ls; s <= le; s++) opts.push(s);
            opts.sort((a, b) => (lunchCount[a] + lunchCount[a+1]) - (lunchCount[b] + lunchCount[b+1]) + (Math.random() - 0.5));
            for (const s of opts) {
                if (tracker.isTFree(q.ti, s, 2) && lunchCount[s] < maxConcurrentLunches && lunchCount[s+1] < maxConcurrentLunches) {
                    schedule.push(this.ent(-1, q.ti, s, 2, 'IndirectTime'));
                    tracker.book(q.ti, -1, s, 2);
                    lunchCount[s]++; lunchCount[s+1]++;
                    break;
                }
            }
        });

        const shuffledC = this.clients.map((c, ci) => ({c, ci})).sort(() => Math.random() - 0.5);
        
        // Pass 2: Allied Health
        shuffledC.forEach(target => {
            target.c.alliedHealthNeeds.forEach(need => {
                if (need.specificDays && !need.specificDays.includes(this.day)) return;
                const len = Math.ceil(need.durationMinutes / SLOT_SIZE);
                const type: SessionType = `AlliedHealth_${need.type}` as SessionType;
                const slots = [];
                for (let s = 0; s <= NUM_SLOTS - len; s++) slots.push(s);
                // Heuristic: Prefer placing AH at edges, but with some randomness to explore
                slots.sort((a, b) => (Math.min(a, NUM_SLOTS - (a + len)) - Math.min(b, NUM_SLOTS - (b + len))) + (Math.random() - 0.5) * 4);
                for (const s of slots) {
                    if (tracker.isCFree(target.ci, s, len)) {
                        const possibleT = this.therapists.map((t, ti) => ({t, ti}))
                            .filter(x => {
                                if (!x.t.canProvideAlliedHealth.includes(need.type)) return false;
                                const reqQual = need.type === 'OT' ? "OT Certified" : "SLP Certified";
                                if (!x.t.qualifications.includes(reqQual)) return false;
                                if (!tracker.isTFree(x.ti, s, len)) return false;
                                // Medicaid limit check
                                if (target.c.insuranceRequirements.includes("MD_MEDICAID") && tracker.cT[target.ci].size >= 3 && !tracker.cT[target.ci].has(x.ti)) return false;
                                return true;
                            })
                            .sort((a, b) => (ROLE_RANK[b.t.role] || 0) - (ROLE_RANK[a.t.role] || 0));
                        if (possibleT.length > 0) {
                            const q = possibleT[0];
                            schedule.push(this.ent(target.ci, q.ti, s, len, type));
                            tracker.book(q.ti, target.ci, s, len);
                            tSessionCount[q.ti]++;
                            break;
                        }
                    }
                }
            });
        });

        // Pass 2.5: BCBA / CF Minimum Assignment (Ensures every senior staff has at least 1 billable session)
        const seniorStaff = sortedTherapists.filter(x => x.t.role === "BCBA" || x.t.role === "CF");
        seniorStaff.forEach(q => {
            if (tSessionCount[q.ti] > 0) return;
            const possibleClients = [...shuffledC].filter(target => this.meetsInsurance(q.t, target.c)).sort(() => Math.random() - 0.5);
            for (const target of possibleClients) {
                if (tracker.cT[target.ci].size >= 3 && target.c.insuranceRequirements.includes("MD_MEDICAID")) continue;
                for (let s = 0; s < NUM_SLOTS - 4; s++) {
                    if (tracker.isCFree(target.ci, s, 4) && tracker.isTFree(q.ti, s, 4)) {
                        if (this.isBTB(schedule, target.c.id, q.t.id, s, 4)) continue;
                        schedule.push(this.ent(target.ci, q.ti, s, 4, 'ABA'));
                        tracker.book(q.ti, target.ci, s, 4);
                        tSessionCount[q.ti]++;
                        break;
                    }
                }
                if (tSessionCount[q.ti] > 0) break;
            }
        });

        // Pass 3: ABA Sessions (Global interleaved approach to ensure fair distribution and gap-free coverage)
        for (let s = 0; s < NUM_SLOTS; s++) {
            const shuffledClientsForSlot = [...shuffledC].sort(() => Math.random() - 0.5);
            shuffledClientsForSlot.forEach(target => {
                if (tracker.isCFree(target.ci, s, 1)) {
                    // Find a therapist for this client starting at slot s
                    const quals = sortedTherapists.filter(x => this.meetsInsurance(x.t, target.c)).sort((a, b) => {
                        // Priority 1: Already working with this client (Medicaid limit safety)
                        const aIsKnown = tracker.cT[target.ci].has(a.ti) ? 0 : 1;
                        const bIsKnown = tracker.cT[target.ci].has(b.ti) ? 0 : 1;
                        if (aIsKnown !== bIsKnown) return aIsKnown - bIsKnown;

                        // Priority 2: Role rank (BT/RBT first for billable work)
                        const aRank = ROLE_RANK[a.t.role] || 0;
                        const bRank = ROLE_RANK[b.t.role] || 0;
                        if (aRank !== bRank) return bRank - aRank; // Higher rank value (lower role) first

                        // Priority 3: Current session count (even distribution among same-tier roles)
                        return (tSessionCount[a.ti] - tSessionCount[b.ti]) + (Math.random() - 0.5) * 2;
                    });

                    for (const q of quals) {
                        // Check Medicaid limit
                        if (tracker.cT[target.ci].size >= 3 && !tracker.cT[target.ci].has(q.ti) && target.c.insuranceRequirements.includes("MD_MEDICAID")) continue;
                        
                        // Try session lengths from 3h down to 1h
                        for (let len = 12; len >= 4; len--) {
                            if (s + len <= NUM_SLOTS && tracker.isCFree(target.ci, s, len) && tracker.isTFree(q.ti, s, len)) {
                                // Heuristic: Avoid leaving small unfillable gaps (< 1h)
                                let gapAfter = 0;
                                let tempS = s + len;
                                while(tempS < NUM_SLOTS && tracker.isCFree(target.ci, tempS, 1)) {
                                    gapAfter++;
                                    tempS++;
                                }
                                if (gapAfter > 0 && gapAfter < 4) continue;

                                if (this.isBTB(schedule, target.c.id, q.t.id, s, len)) continue;
                                schedule.push(this.ent(target.ci, q.ti, s, len, 'ABA'));
                                tracker.book(q.ti, target.ci, s, len);
                                tSessionCount[q.ti]++;
                                break;
                            }
                        }
                        if (!tracker.isCFree(target.ci, s, 1)) break;
                    }
                }
            });
        }

        // Filter out lunches for people with no billable work
        return schedule.filter(e => {
            if (e.sessionType !== 'IndirectTime') return true;
            return schedule.some(s =>
                s.therapistId === e.therapistId &&
                (s.sessionType === 'ABA' || s.sessionType.startsWith('AlliedHealth_'))
            );
        });
    }

    private isBTB(s: GeneratedSchedule, cid: string, tid: string, startSlot: number, len: number) {
        const startMin = OP_START + startSlot * SLOT_SIZE;
        const endMin = OP_START + (startSlot + len) * SLOT_SIZE;
        return s.some(x => x.clientId === cid && x.therapistId === tid && (timeToMinutes(x.endTime) === startMin || timeToMinutes(x.startTime) === endMin));
    }

    private ent(ci: number, ti: number, s: number, l: number, type: SessionType): ScheduleEntry {
        const client = ci >= 0 ? this.clients[ci] : null;
        const therapist = this.therapists[ti];
        return { id: generateId(), clientId: client ? client.id : null, clientName: client ? client.name : null, therapistId: therapist.id, therapistName: therapist.name, day: this.day, startTime: minutesToTime(OP_START + s * SLOT_SIZE), endTime: minutesToTime(OP_START + (s + l) * SLOT_SIZE), sessionType: type };
    }

    public async run(initialSchedule?: GeneratedSchedule): Promise<GeneratedSchedule> {
        let best: GeneratedSchedule = [];
        let minScore = Infinity;
        const iterations = this.clients.length > 15 ? 10000 : 5000;
        for (let i = 0; i < iterations; i++) {
            if (i > 0 && i % 500 === 0) await new Promise(r => setTimeout(r, 0));
            const s = this.createSchedule(initialSchedule);
            const score = this.calculateScore(s);
            if (score < minScore) {
                best = s;
                minScore = score;
                if (minScore === 0) break;
            }
            // Dynamic adjustment: if we're halfway and still have gaps, maybe we need more randomness in Pass 2/3
        }
        return best;
    }

    private calculateScore(s: GeneratedSchedule): number {
        const errs = validateFullSchedule(s, this.clients, this.therapists, this.selectedDate, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, this.callouts);
        if (errs.length > 0) {
            let p = 10000000; // Higher base penalty for any error
            errs.forEach(e => {
                if (e.ruleId === "CLIENT_COVERAGE_GAP_AT_TIME") p += 1000000; // Even higher penalty for gaps
                else if (e.ruleId === "THERAPIST_TIME_CONFLICT" || e.ruleId === "CLIENT_TIME_CONFLICT") p += 2000000;
                else if (e.ruleId === "MD_MEDICAID_LIMIT_VIOLATED") p += 500000;
                else if (e.ruleId === "BCBA_NO_DIRECT_TIME") p += 500000;
                else if (e.ruleId === "MAX_NOTES_EXCEEDED") p += 10;
                else p += 1000;
            });
            return p;
        }
        
        let penalty = 0;
        const ROLE_PRIO: any = { "BCBA": 7, "CF": 6, "STAR 3": 5, "STAR 2": 4, "STAR 1": 3, "RBT": 2, "BT": 1, "Other": 0 };
        const billableTimes = new Map<string, number>();
        s.forEach(e => {
            if (e.sessionType === 'ABA' || e.sessionType.startsWith('AlliedHealth_')) {
                const dur = timeToMinutes(e.endTime) - timeToMinutes(e.startTime);
                billableTimes.set(e.therapistId, (billableTimes.get(e.therapistId) || 0) + dur);
            }
        });

        const data = this.therapists.map(t => ({ p: ROLE_PRIO[t.role] || 0, billable: billableTimes.get(t.id) || 0 }));
        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < data.length; j++) {
                if (data[i].p > data[j].p && data[i].billable > data[j].billable) {
                    penalty += (data[i].billable - data[j].billable) * 100;
                }
            }
        }
        return penalty;
    }
}

export async function runCsoAlgorithm(
    clients: Client[],
    therapists: Therapist[],
    selectedDate: Date,
    callouts: Callout[],
    initialScheduleForOptimization?: GeneratedSchedule
): Promise<GAGenerationResult> {
    const day = getDayOfWeekFromDate(selectedDate);
    const algo = new FastScheduler(clients, therapists, day, selectedDate, callouts);
    const schedule = await algo.run(initialScheduleForOptimization);
    const errors = validateFullSchedule(schedule, clients, therapists, selectedDate, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, callouts);
    return { schedule, finalValidationErrors: errors, generations: 0, bestFitness: errors.length, success: errors.length === 0, statusMessage: errors.length === 0 ? "Perfect!" : "Nearly Perfect." };
}
