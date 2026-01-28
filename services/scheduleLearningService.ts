
import { GeneratedSchedule, ScheduleEntry, Client, Therapist, ValidationError } from '../types';
import { supabase } from '../lib/supabase';
import { timeToMinutes, minutesToTime } from '../utils/validationService';

export interface ScheduleFeedback {
  schedule: GeneratedSchedule;
  rating: number;
  violationsCount: number;
  violationsDetail: ValidationError[];
  feedbackText?: string;
  teamId?: string;
}

export interface LearnedPattern {
  type: string;
  data: Record<string, any>;
  effectivenessScore: number;
  sampleCount: number;
}

export interface ConstraintPattern {
  ruleId: string;
  violationCount: number;
  averageSeverity: number;
  commonContext: Record<string, any>;
}

export class ScheduleLearningService {
  static async submitFeedback(feedback: ScheduleFeedback): Promise<boolean> {
    try {
      const { error } = await supabase.from('schedule_feedback').insert({
        schedule_json: feedback.schedule,
        rating: feedback.rating,
        violations_count: feedback.violationsCount,
        violations_detail: feedback.violationsDetail,
        feedback_text: feedback.feedbackText,
        team_id: feedback.teamId,
        created_at: new Date().toISOString()
      });

      if (error) {
        console.error('Error submitting feedback:', error);
        return false;
      }

      await this.updatePatterns(feedback);
      return true;
    } catch (e) {
      console.error('Error in submitFeedback:', e);
      return false;
    }
  }

  static async getHighRatedSchedules(minRating: number = 4): Promise<GeneratedSchedule[]> {
    try {
      const { data, error } = await supabase
        .from('schedule_feedback')
        .select('schedule_json')
        .gte('rating', minRating)
        .order('rating', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []).map(row => row.schedule_json);
    } catch (e) {
      console.error('Error fetching high-rated schedules:', e);
      return [];
    }
  }

  static async analyzeBestPatterns(): Promise<LearnedPattern[]> {
    try {
      const { data, error } = await supabase
        .from('schedule_patterns')
        .select('*')
        .order('effectiveness_score', { ascending: false })
        .limit(20);

      if (error) throw error;
      return (data || []).map(row => ({
        type: row.pattern_type,
        data: row.pattern_data,
        effectivenessScore: row.effectiveness_score,
        sampleCount: row.sample_count
      }));
    } catch (e) {
      console.error('Error analyzing patterns:', e);
      return [];
    }
  }

  static async getConstraintProblems(): Promise<ConstraintPattern[]> {
    try {
      const { data, error } = await supabase
        .from('constraint_violations_log')
        .select('*')
        .order('violation_count', { ascending: false })
        .limit(15);

      if (error) throw error;
      return (data || []).map(row => ({
        ruleId: row.rule_id,
        violationCount: row.violation_count,
        averageSeverity: row.average_severity,
        commonContext: {}
      }));
    } catch (e) {
      console.error('Error getting constraint problems:', e);
      return [];
    }
  }

  static async updatePatterns(feedback: ScheduleFeedback): Promise<void> {
    if (feedback.rating < 4) return;

    try {
      const patterns = this.extractPatterns(feedback.schedule);
      for (const pattern of patterns) {
        await this.upsertPattern(pattern, feedback.rating);
      }

      for (const violation of feedback.violationsDetail) {
        await this.recordViolation(violation.ruleId);
      }
    } catch (e) {
      console.error('Error updating patterns:', e);
    }
  }

  private static extractPatterns(schedule: GeneratedSchedule): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];

    const therapistLunches = this.extractLunchPatterns(schedule);
    if (therapistLunches.length > 0) {
      patterns.push({
        type: 'lunch_stagger',
        data: { lunches: therapistLunches },
        effectivenessScore: 0,
        sampleCount: 1
      });
    }

    const sessionDurations = this.extractSessionDurationPatterns(schedule);
    if (Object.keys(sessionDurations).length > 0) {
      patterns.push({
        type: 'session_duration',
        data: sessionDurations,
        effectivenessScore: 0,
        sampleCount: 1
      });
    }

    const therapistLoadDistribution = this.extractLoadDistribution(schedule);
    if (therapistLoadDistribution.length > 0) {
      patterns.push({
        type: 'load_distribution',
        data: { distribution: therapistLoadDistribution },
        effectivenessScore: 0,
        sampleCount: 1
      });
    }

    return patterns;
  }

  private static extractLunchPatterns(schedule: GeneratedSchedule): Array<{
    therapistId: string;
    startTime: string;
    endTime: string;
  }> {
    return schedule
      .filter(s => s.sessionType === 'IndirectTime')
      .map(s => ({
        therapistId: s.therapistId,
        startTime: s.startTime,
        endTime: s.endTime
      }));
  }

  private static extractSessionDurationPatterns(schedule: GeneratedSchedule): Record<string, number[]> {
    const patterns: Record<string, number[]> = {
      ABA: [],
      AlliedHealth: [],
      IndirectTime: []
    };

    schedule.forEach(entry => {
      const duration = timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
      if (entry.sessionType === 'ABA') {
        patterns.ABA.push(duration);
      } else if (entry.sessionType.startsWith('AlliedHealth_')) {
        patterns.AlliedHealth.push(duration);
      } else if (entry.sessionType === 'IndirectTime') {
        patterns.IndirectTime.push(duration);
      }
    });

    return patterns;
  }

  private static extractLoadDistribution(schedule: GeneratedSchedule): Array<{
    therapistId: string;
    billableMinutes: number;
    clientCount: number;
  }> {
    const therapistStats = new Map<
      string,
      { billableMinutes: number; clientIds: Set<string> }
    >();

    schedule.forEach(entry => {
      if (!therapistStats.has(entry.therapistId)) {
        therapistStats.set(entry.therapistId, {
          billableMinutes: 0,
          clientIds: new Set()
        });
      }

      const stats = therapistStats.get(entry.therapistId)!;
      if (entry.sessionType !== 'IndirectTime') {
        stats.billableMinutes += timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
        if (entry.clientId) {
          stats.clientIds.add(entry.clientId);
        }
      }
    });

    return Array.from(therapistStats.entries()).map(([therapistId, stats]) => ({
      therapistId,
      billableMinutes: stats.billableMinutes,
      clientCount: stats.clientIds.size
    }));
  }

  private static async upsertPattern(
    pattern: LearnedPattern,
    rating: number
  ): Promise<void> {
    try {
      const effectivenessBoost = rating > 4 ? 0.1 : 0.02;

      const { data: existing, error: fetchError } = await supabase
        .from('schedule_patterns')
        .select('id, effectiveness_score, sample_count')
        .eq('pattern_type', pattern.type)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existing) {
        const newEffectiveness = existing.effectiveness_score + effectivenessBoost;
        const newSampleCount = existing.sample_count + 1;

        const { error: updateError } = await supabase
          .from('schedule_patterns')
          .update({
            effectiveness_score: newEffectiveness,
            sample_count: newSampleCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('schedule_patterns')
          .insert({
            pattern_type: pattern.type,
            pattern_data: pattern.data,
            effectiveness_score: effectivenessBoost,
            sample_count: 1,
            created_at: new Date().toISOString()
          });

        if (insertError) throw insertError;
      }
    } catch (e) {
      console.error('Error upserting pattern:', e);
    }
  }

  private static async recordViolation(ruleId: string): Promise<void> {
    try {
      const { data: existing, error: fetchError } = await supabase
        .from('constraint_violations_log')
        .select('id, violation_count')
        .eq('rule_id', ruleId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existing) {
        const { error: updateError } = await supabase
          .from('constraint_violations_log')
          .update({
            violation_count: existing.violation_count + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('constraint_violations_log')
          .insert({
            rule_id: ruleId,
            violation_count: 1,
            created_at: new Date().toISOString()
          });

        if (insertError) throw insertError;
      }
    } catch (e) {
      console.error('Error recording violation:', e);
    }
  }

  static async getAverageFeedbackRating(limit: number = 100): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('schedule_feedback')
        .select('rating')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      if (!data || data.length === 0) return 0;

      const sum = data.reduce((acc, row) => acc + row.rating, 0);
      return sum / data.length;
    } catch (e) {
      console.error('Error getting average rating:', e);
      return 0;
    }
  }

  static async getSelfDiagnostics(): Promise<{
    averageRating: number;
    improvementAreas: string[];
    strengths: string[];
    recommendedFocusAreas: string[];
  }> {
    try {
      const avgRating = await this.getAverageFeedbackRating();
      const constraints = await this.getConstraintProblems();
      const patterns = await this.analyzeBestPatterns();

      const improvementAreas = constraints
        .slice(0, 5)
        .map(c => c.ruleId);

      const strengths = patterns
        .filter(p => p.effectivenessScore > 0.5)
        .slice(0, 3)
        .map(p => p.type);

      const recommendedFocusAreas = improvementAreas.slice(0, 3);

      return {
        averageRating: avgRating,
        improvementAreas,
        strengths,
        recommendedFocusAreas
      };
    } catch (e) {
      console.error('Error in getSelfDiagnostics:', e);
      return {
        averageRating: 0,
        improvementAreas: [],
        strengths: [],
        recommendedFocusAreas: []
      };
    }
  }
}
