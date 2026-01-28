import { Therapist } from '../types';
import { supabase } from '../lib/supabase';

let _therapists: Therapist[] = [];
const listeners: Array<(therapists: Therapist[]) => void> = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._therapists]));
};

const loadTherapists = async () => {
  try {
    const { data, error } = await supabase
      .from('therapists')
      .select('*')
      .order('name');

    if (error) throw error;

    _therapists = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id || undefined,
      qualifications: row.qualifications || [],
      canProvideAlliedHealth: row.can_provide_allied_health || []
    }));

    notifyListeners();
  } catch (error) {
    console.error("Error loading therapists from Supabase:", error);
    _therapists = [];
  }
};

loadTherapists();

const setupRealtimeSubscription = () => {
  supabase
    .channel('therapists_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'therapists' }, () => {
      loadTherapists();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getTherapists = (): Therapist[] => {
  return [..._therapists];
};

export const addTherapist = async (newTherapistData: Omit<Therapist, 'id'>): Promise<Therapist> => {
  try {
    const { data, error } = await supabase
      .from('therapists')
      .insert({
        name: newTherapistData.name,
        team_id: newTherapistData.teamId || null,
        qualifications: newTherapistData.qualifications || [],
        can_provide_allied_health: newTherapistData.canProvideAlliedHealth || []
      })
      .select()
      .single();

    if (error) throw error;

    const therapist: Therapist = {
      id: data.id,
      name: data.name,
      teamId: data.team_id || undefined,
      qualifications: data.qualifications || [],
      canProvideAlliedHealth: data.can_provide_allied_health || []
    };

    await loadTherapists();
    return therapist;
  } catch (error) {
    console.error("Error adding therapist:", error);
    throw error;
  }
};

export const updateTherapist = async (updatedTherapist: Therapist): Promise<Therapist | undefined> => {
  try {
    const { error } = await supabase
      .from('therapists')
      .update({
        name: updatedTherapist.name,
        team_id: updatedTherapist.teamId || null,
        qualifications: updatedTherapist.qualifications,
        can_provide_allied_health: updatedTherapist.canProvideAlliedHealth,
        updated_at: new Date().toISOString()
      })
      .eq('id', updatedTherapist.id);

    if (error) throw error;

    await loadTherapists();
    return updatedTherapist;
  } catch (error) {
    console.error("Error updating therapist:", error);
    throw error;
  }
};

export const removeTherapist = async (therapistId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('therapists')
      .delete()
      .eq('id', therapistId);

    if (error) throw error;

    await loadTherapists();
    return true;
  } catch (error) {
    console.error("Error removing therapist:", error);
    return false;
  }
};

export const addOrUpdateBulkTherapists = async (therapistsToProcess: Partial<Omit<Therapist, 'canCoverIndirect'>>[]): Promise<{ addedCount: number; updatedCount: number }> => {
  let addedCount = 0;
  let updatedCount = 0;

  for (const therapistData of therapistsToProcess) {
    if (!therapistData.name) continue;

    try {
      const { data: existing } = await supabase
        .from('therapists')
        .select('id')
        .ilike('name', therapistData.name)
        .maybeSingle();

      if (existing) {
        const updateData: any = { updated_at: new Date().toISOString() };
        if (therapistData.teamId !== undefined) updateData.team_id = therapistData.teamId || null;
        if (therapistData.qualifications !== undefined) updateData.qualifications = therapistData.qualifications;
        if (therapistData.canProvideAlliedHealth !== undefined) updateData.can_provide_allied_health = therapistData.canProvideAlliedHealth;

        await supabase
          .from('therapists')
          .update(updateData)
          .eq('id', existing.id);

        updatedCount++;
      } else {
        await supabase
          .from('therapists')
          .insert({
            name: therapistData.name,
            team_id: therapistData.teamId || null,
            qualifications: therapistData.qualifications || [],
            can_provide_allied_health: therapistData.canProvideAlliedHealth || []
          });

        addedCount++;
      }
    } catch (error) {
      console.error("Error processing therapist:", therapistData.name, error);
    }
  }

  await loadTherapists();
  return { addedCount, updatedCount };
};

export const removeTherapistsByNames = async (therapistNamesToRemove: string[]): Promise<{ removedCount: number }> => {
  let removedCount = 0;

  for (const name of therapistNamesToRemove) {
    try {
      const { data } = await supabase
        .from('therapists')
        .delete()
        .ilike('name', name)
        .select();

      if (data) removedCount += data.length;
    } catch (error) {
      console.error("Error removing therapist:", name, error);
    }
  }

  await loadTherapists();
  return { removedCount };
};

export const subscribeToTherapists = (listener: (therapists: Therapist[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._therapists]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};