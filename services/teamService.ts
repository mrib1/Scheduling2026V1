import { Team } from '../types';
import { supabase } from '../lib/supabase';

let _teams: Team[] = [];
const listeners: Array<(teams: Team[]) => void> = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._teams]));
};

const loadTeams = async () => {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('name');

    if (error) throw error;

    _teams = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      color: row.color
    }));

    notifyListeners();
  } catch (error) {
    console.error("Error loading teams from Supabase:", error);
    _teams = [];
  }
};

loadTeams();

const setupRealtimeSubscription = () => {
  supabase
    .channel('teams_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
      loadTeams();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getTeams = (): Team[] => {
  return [..._teams];
};

export const updateTeams = async (updatedTeams: Team[]): Promise<Team[]> => {
  try {
    const existingTeamIds = _teams.map(t => t.id);
    const updatedTeamIds = updatedTeams.map(t => t.id);

    const teamsToDelete = existingTeamIds.filter(id => !updatedTeamIds.includes(id));
    for (const id of teamsToDelete) {
      await supabase.from('teams').delete().eq('id', id);
    }

    for (const team of updatedTeams) {
      if (existingTeamIds.includes(team.id)) {
        await supabase
          .from('teams')
          .update({
            name: team.name,
            color: team.color,
            updated_at: new Date().toISOString()
          })
          .eq('id', team.id);
      } else {
        await supabase
          .from('teams')
          .insert({
            id: team.id,
            name: team.name,
            color: team.color
          });
      }
    }

    await loadTeams();
    return [..._teams];
  } catch (error) {
    console.error("Error updating teams:", error);
    throw error;
  }
};

export const subscribeToTeams = (listener: (teams: Team[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._teams]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};