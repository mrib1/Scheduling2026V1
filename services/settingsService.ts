import { supabase } from '../lib/supabase';

let _qualifications: string[] = [];
const listeners: Array<(qualifications: string[]) => void> = [];
const SETTINGS_KEY = 'insurance_qualifications';

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._qualifications]));
};

const loadQualifications = async () => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (error) throw error;

    if (data && data.value) {
      _qualifications = Array.isArray(data.value) ? data.value : [];
    } else {
      _qualifications = ['RBT', 'BCBA', 'Clinical Fellow', 'MD_MEDICAID'];
      await supabase
        .from('settings')
        .insert({
          key: SETTINGS_KEY,
          value: _qualifications
        });
    }

    _qualifications = Array.from(new Set(_qualifications)).sort((a, b) => a.localeCompare(b));
    notifyListeners();
  } catch (error) {
    console.error("Error loading qualifications from Supabase:", error);
    _qualifications = [];
  }
};

loadQualifications();

const setupRealtimeSubscription = () => {
  supabase
    .channel('settings_changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'settings',
      filter: `key=eq.${SETTINGS_KEY}`
    }, () => {
      loadQualifications();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getInsuranceQualifications = (): string[] => {
  return [..._qualifications];
};

export const updateInsuranceQualifications = async (updatedQualifications: string[]): Promise<string[]> => {
  try {
    const uniqueSortedQualifications = Array.from(new Set(updatedQualifications)).sort((a, b) => a.localeCompare(b));

    const { error } = await supabase
      .from('settings')
      .upsert({
        key: SETTINGS_KEY,
        value: uniqueSortedQualifications,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      });

    if (error) throw error;

    await loadQualifications();
    return [..._qualifications];
  } catch (error) {
    console.error("Error updating qualifications:", error);
    throw error;
  }
};

export const subscribeToInsuranceQualifications = (listener: (qualifications: string[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._qualifications]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};