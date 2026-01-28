import { BaseScheduleConfig, GeneratedSchedule } from '../types';
import { supabase } from '../lib/supabase';

const generateScheduleEntryId = () => `schedEntry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

let _baseSchedules: BaseScheduleConfig[] = [];
const listeners: Array<(schedules: BaseScheduleConfig[]) => void> = [];

const ensureEntryIds = (schedule: GeneratedSchedule | null): GeneratedSchedule | null => {
  if (!schedule) return null;
  return schedule.map(entry => ({ ...entry, id: entry.id || generateScheduleEntryId() }));
};

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._baseSchedules]));
};

const loadBaseSchedules = async () => {
  try {
    const { data, error } = await supabase
      .from('base_schedules')
      .select('*')
      .order('name');

    if (error) throw error;

    _baseSchedules = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      appliesToDays: row.applies_to_days || [],
      schedule: ensureEntryIds(row.schedule)
    }));

    notifyListeners();
  } catch (error) {
    console.error("Error loading base schedules from Supabase:", error);
    _baseSchedules = [];
  }
};

loadBaseSchedules();

const setupRealtimeSubscription = () => {
  supabase
    .channel('base_schedules_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'base_schedules' }, () => {
      loadBaseSchedules();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getBaseSchedules = (): BaseScheduleConfig[] => {
  return [..._baseSchedules.map(bs => ({ ...bs, schedule: ensureEntryIds(bs.schedule) }))];
};

export const updateBaseSchedules = async (updatedSchedules: BaseScheduleConfig[]): Promise<BaseScheduleConfig[]> => {
  try {
    const existingIds = _baseSchedules.map(bs => bs.id);
    const updatedIds = updatedSchedules.map(bs => bs.id);

    const schedulesToDelete = existingIds.filter(id => !updatedIds.includes(id));
    for (const id of schedulesToDelete) {
      await supabase.from('base_schedules').delete().eq('id', id);
    }

    for (const schedule of updatedSchedules) {
      const scheduleWithIds = ensureEntryIds(schedule.schedule);

      if (existingIds.includes(schedule.id)) {
        await supabase
          .from('base_schedules')
          .update({
            name: schedule.name,
            applies_to_days: schedule.appliesToDays,
            schedule: scheduleWithIds,
            updated_at: new Date().toISOString()
          })
          .eq('id', schedule.id);
      } else {
        await supabase
          .from('base_schedules')
          .insert({
            id: schedule.id,
            name: schedule.name,
            applies_to_days: schedule.appliesToDays,
            schedule: scheduleWithIds
          });
      }
    }

    await loadBaseSchedules();
    return [..._baseSchedules];
  } catch (error) {
    console.error("Error updating base schedules:", error);
    throw error;
  }
};

export const subscribeToBaseSchedules = (listener: (schedules: BaseScheduleConfig[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._baseSchedules.map(bs => ({ ...bs, schedule: ensureEntryIds(bs.schedule) }))]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};