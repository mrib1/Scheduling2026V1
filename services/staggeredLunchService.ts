import { GeneratedSchedule, Client, Therapist, DayOfWeek, Callout } from '../types';
import { timeToMinutes, minutesToTime, isDateAffectedByCalloutRange } from '../utils/validationService';
import { COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END, IDEAL_LUNCH_WINDOW_START, IDEAL_LUNCH_WINDOW_END_FOR_START } from '../constants';
import { supabase } from '../lib/supabase';

export interface LunchStaggerSlot {
  therapistId: string;
  therapistName: string;
  lunchStartTime: number;
  lunchEndTime: number;
  clientsCovered: string[];
}

export interface TeamLunchStagger {
  teamId: string;
  slots: LunchStaggerSlot[];
  minCoveragePercentage: number;
  isValid: boolean;
}

export class StaggeredLunchService {
  static async applyStaggeredLunches(
    schedule: GeneratedSchedule,
    clients: Client[],
    therapists: Therapist[],
    day: DayOfWeek,
    selectedDate: Date,
    callouts: Callout[]
  ): Promise<GeneratedSchedule> {
    const teams = new Map<string, Therapist[]>();

    therapists.forEach(t => {
      const teamId = t.teamId || 'no_team';
      if (!teams.has(teamId)) {
        teams.set(teamId, []);
      }
      teams.get(teamId)!.push(t);
    });

    for (const [teamId, teamTherapists] of teams) {
      const teamClients = clients.filter(c => c.teamId === teamId);
      await this.staggerTeamLunches(
        schedule,
        teamTherapists,
        teamClients,
        day,
        selectedDate,
        callouts,
        teamId
      );
    }

    return schedule;
  }

  private static async staggerTeamLunches(
    schedule: GeneratedSchedule,
    teamTherapists: Therapist[],
    teamClients: Client[],
    day: DayOfWeek,
    selectedDate: Date,
    callouts: Callout[],
    teamId: string
  ): Promise<void> {
    const workingTherapists = teamTherapists.filter(t =>
      schedule.some(s => s.therapistId === t.id && s.sessionType !== 'IndirectTime')
    );

    if (workingTherapists.length === 0) return;

    const lunchWindowStart = timeToMinutes(IDEAL_LUNCH_WINDOW_START);
    const lunchWindowEnd = timeToMinutes(IDEAL_LUNCH_WINDOW_END_FOR_START);
    const lunchDuration = 30;

    const timeSlots: number[] = [];
    for (let time = lunchWindowStart; time <= lunchWindowEnd - lunchDuration; time += 15) {
      timeSlots.push(time);
    }

    const numSlots = Math.min(Math.ceil(workingTherapists.length / 2), timeSlots.length);
    const slotSize = Math.max(1, Math.floor(timeSlots.length / numSlots));
    const selectedSlots = timeSlots.filter((_, idx) => idx % slotSize === 0).slice(0, numSlots);

    const assignments = this.assignTherapistsToSlots(
      schedule,
      workingTherapists,
      selectedSlots,
      lunchDuration,
      teamClients,
      callouts,
      selectedDate
    );

    for (const [therapistId, slotTime] of assignments) {
      const therapist = teamTherapists.find(t => t.id === therapistId);
      if (!therapist) continue;

      const hasLunch = schedule.some(s => s.therapistId === therapistId && s.sessionType === 'IndirectTime');
      if (!hasLunch) {
        schedule.push({
          id: `lunch-${Date.now()}-${Math.random()}`,
          clientName: null,
          clientId: null,
          therapistName: therapist.name,
          therapistId: therapist.id,
          day,
          startTime: minutesToTime(slotTime),
          endTime: minutesToTime(slotTime + lunchDuration),
          sessionType: 'IndirectTime'
        });
      }
    }

    await this.saveLunchPattern(teamId, day, selectedSlots, teamClients, schedule);
  }

  private static assignTherapistsToSlots(
    schedule: GeneratedSchedule,
    therapists: Therapist[],
    slots: number[],
    lunchDuration: number,
    teamClients: Client[],
    callouts: Callout[],
    selectedDate: Date
  ): Map<string, number> {
    const assignments = new Map<string, number>();

    const therapistsByLoad = therapists
      .map(t => ({
        therapist: t,
        billableMinutes: this.calculateBillableMinutes(schedule, t.id),
        clientCount: new Set(
          schedule
            .filter(s => s.therapistId === t.id && s.clientId)
            .map(s => s.clientId!)
        ).size
      }))
      .sort((a, b) => {
        const loadDiff = b.billableMinutes - a.billableMinutes;
        return loadDiff !== 0 ? loadDiff : b.clientCount - a.clientCount;
      });

    for (const { therapist } of therapistsByLoad) {
      let bestSlot: number | null = null;
      let bestCoverage = 0;

      for (const slot of slots) {
        if (!this.canScheduleLunch(therapist.id, slot, lunchDuration, schedule)) {
          continue;
        }

        const coverage = this.estimateCoverageWithLunch(
          schedule,
          therapist.id,
          slot,
          teamClients,
          callouts,
          selectedDate
        );

        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestSlot = slot;
        }
      }

      if (bestSlot !== null) {
        assignments.set(therapist.id, bestSlot);
      }
    }

    return assignments;
  }

  private static canScheduleLunch(
    therapistId: string,
    slotTime: number,
    duration: number,
    schedule: GeneratedSchedule
  ): boolean {
    return !schedule.some(
      s =>
        s.therapistId === therapistId &&
        this.timeRangesOverlap(
          slotTime,
          slotTime + duration,
          timeToMinutes(s.startTime),
          timeToMinutes(s.endTime)
        )
    );
  }

  private static timeRangesOverlap(
    start1: number,
    end1: number,
    start2: number,
    end2: number
  ): boolean {
    return start1 < end2 && start2 < end1;
  }

  private static calculateBillableMinutes(
    schedule: GeneratedSchedule,
    therapistId: string
  ): number {
    return schedule
      .filter(
        s =>
          s.therapistId === therapistId &&
          s.sessionType !== 'IndirectTime'
      )
      .reduce((sum, s) => {
        return sum + (timeToMinutes(s.endTime) - timeToMinutes(s.startTime));
      }, 0);
  }

  private static estimateCoverageWithLunch(
    schedule: GeneratedSchedule,
    therapistId: string,
    lunchSlot: number,
    teamClients: Client[],
    callouts: Callout[],
    selectedDate: Date
  ): number {
    const opStart = timeToMinutes(COMPANY_OPERATING_HOURS_START);
    const opEnd = timeToMinutes(COMPANY_OPERATING_HOURS_END);
    let totalCovered = 0;

    for (const client of teamClients) {
      for (let time = opStart; time < opEnd; time += 15) {
        const isCovered = schedule.some(
          s =>
            s.clientId === client.id &&
            s.therapistId === therapistId &&
            s.sessionType !== 'IndirectTime' &&
            time >= timeToMinutes(s.startTime) &&
            time < timeToMinutes(s.endTime)
        );

        const isLunch = this.timeRangesOverlap(time, time + 15, lunchSlot, lunchSlot + 30);

        if (isCovered && !isLunch) {
          totalCovered++;
        }
      }
    }

    return totalCovered;
  }

  private static async saveLunchPattern(
    teamId: string,
    day: DayOfWeek,
    slots: number[],
    clients: Client[],
    schedule: GeneratedSchedule
  ): Promise<void> {
    try {
      const slotData = slots.map(s => ({
        startTime: minutesToTime(s),
        endTime: minutesToTime(s + 30)
      }));

      const opStart = timeToMinutes(COMPANY_OPERATING_HOURS_START);
      const opEnd = timeToMinutes(COMPANY_OPERATING_HOURS_END);
      let coveredMinutes = 0;
      let totalMinutes = 0;

      for (const client of clients) {
        for (let time = opStart; time < opEnd; time += 15) {
          totalMinutes++;
          const isCovered = schedule.some(
            s =>
              s.clientId === client.id &&
              s.sessionType !== 'IndirectTime' &&
              time >= timeToMinutes(s.startTime) &&
              time < timeToMinutes(s.endTime)
          );
          if (isCovered) coveredMinutes++;
        }
      }

      const coverage = totalMinutes > 0 ? (coveredMinutes / totalMinutes) * 100 : 0;

      await supabase.from('lunch_stagger_patterns').insert({
        team_id: teamId,
        day_of_week: day,
        stagger_slots: slotData,
        coverage_percentage: coverage,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('Error saving lunch pattern:', e);
    }
  }

  static async getBestStaggerPattern(
    teamId: string,
    day: DayOfWeek
  ): Promise<number[] | null> {
    try {
      const { data, error } = await supabase
        .from('lunch_stagger_patterns')
        .select('stagger_slots')
        .eq('team_id', teamId)
        .eq('day_of_week', day)
        .order('coverage_percentage', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      return (data.stagger_slots as Array<{ startTime: string }>).map(
        slot => timeToMinutes(slot.startTime)
      );
    } catch (e) {
      console.error('Error getting stagger pattern:', e);
      return null;
    }
  }
}