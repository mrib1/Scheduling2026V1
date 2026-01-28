import { Callout } from '../types';
import { supabase } from '../lib/supabase';
import { timeToMinutes } from '../utils/validationService';

let _callouts: Callout[] = [];
const listeners: Array<(callouts: Callout[]) => void> = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._callouts]));
};

const loadCallouts = async () => {
  try {
    const { data, error } = await supabase
      .from('callouts')
      .select('*')
      .order('start_date')
      .order('start_time');

    if (error) throw error;

    _callouts = (data || []).map(row => ({
      id: row.id,
      entityType: row.entity_type as 'client' | 'therapist',
      entityId: row.entity_id,
      entityName: row.entity_name,
      startDate: row.start_date,
      endDate: row.end_date,
      startTime: row.start_time,
      endTime: row.end_time,
      reason: row.reason
    }));

    notifyListeners();
  } catch (error) {
    console.error("Error loading callouts from Supabase:", error);
    _callouts = [];
  }
};

loadCallouts();

const setupRealtimeSubscription = () => {
  supabase
    .channel('callouts_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'callouts' }, () => {
      loadCallouts();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getCallouts = (): Callout[] => {
  return [..._callouts];
};

export const addCalloutEntry = async (newCallout: Omit<Callout, 'id'>): Promise<Callout[]> => {
  try {
    const { error } = await supabase
      .from('callouts')
      .insert({
        entity_type: newCallout.entityType,
        entity_id: newCallout.entityId,
        entity_name: newCallout.entityName,
        start_date: newCallout.startDate,
        end_date: newCallout.endDate,
        start_time: newCallout.startTime,
        end_time: newCallout.endTime,
        reason: newCallout.reason
      });

    if (error) throw error;

    await loadCallouts();
    return [..._callouts];
  } catch (error) {
    console.error("Error adding callout:", error);
    throw error;
  }
};

export const removeCalloutEntry = async (calloutId: string): Promise<Callout[]> => {
  try {
    const { error } = await supabase
      .from('callouts')
      .delete()
      .eq('id', calloutId);

    if (error) throw error;

    await loadCallouts();
    return [..._callouts];
  } catch (error) {
    console.error("Error removing callout:", error);
    throw error;
  }
};

export const updateCalloutEntry = async (updatedCallout: Callout): Promise<Callout[]> => {
  try {
    const { error } = await supabase
      .from('callouts')
      .update({
        entity_type: updatedCallout.entityType,
        entity_id: updatedCallout.entityId,
        entity_name: updatedCallout.entityName,
        start_date: updatedCallout.startDate,
        end_date: updatedCallout.endDate,
        start_time: updatedCallout.startTime,
        end_time: updatedCallout.endTime,
        reason: updatedCallout.reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', updatedCallout.id);

    if (error) throw error;

    await loadCallouts();
    return [..._callouts];
  } catch (error) {
    console.error("Error updating callout:", error);
    throw error;
  }
};

export const subscribeToCallouts = (listener: (callouts: Callout[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._callouts]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};