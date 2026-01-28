import { Client } from '../types';
import { supabase } from '../lib/supabase';

let _clients: Client[] = [];
const listeners: Array<(clients: Client[]) => void> = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([..._clients]));
};

const loadClients = async () => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('name');

    if (error) throw error;

    _clients = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id || undefined,
      insuranceRequirements: row.insurance_requirements || [],
      alliedHealthNeeds: row.allied_health_needs || []
    }));

    notifyListeners();
  } catch (error) {
    console.error("Error loading clients from Supabase:", error);
    _clients = [];
  }
};

loadClients();

const setupRealtimeSubscription = () => {
  supabase
    .channel('clients_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
      loadClients();
    })
    .subscribe();
};

setupRealtimeSubscription();

export const getClients = (): Client[] => {
  return [..._clients];
};

export const addClient = async (newClientData: Omit<Client, 'id'>): Promise<Client> => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .insert({
        name: newClientData.name,
        team_id: newClientData.teamId || null,
        insurance_requirements: newClientData.insuranceRequirements || [],
        allied_health_needs: newClientData.alliedHealthNeeds || []
      })
      .select()
      .single();

    if (error) throw error;

    const client: Client = {
      id: data.id,
      name: data.name,
      teamId: data.team_id || undefined,
      insuranceRequirements: data.insurance_requirements || [],
      alliedHealthNeeds: data.allied_health_needs || []
    };

    await loadClients();
    return client;
  } catch (error) {
    console.error("Error adding client:", error);
    throw error;
  }
};

export const updateClient = async (updatedClient: Client): Promise<Client | undefined> => {
  try {
    const { error } = await supabase
      .from('clients')
      .update({
        name: updatedClient.name,
        team_id: updatedClient.teamId || null,
        insurance_requirements: updatedClient.insuranceRequirements,
        allied_health_needs: updatedClient.alliedHealthNeeds,
        updated_at: new Date().toISOString()
      })
      .eq('id', updatedClient.id);

    if (error) throw error;

    await loadClients();
    return updatedClient;
  } catch (error) {
    console.error("Error updating client:", error);
    throw error;
  }
};

export const removeClient = async (clientId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId);

    if (error) throw error;

    await loadClients();
    return true;
  } catch (error) {
    console.error("Error removing client:", error);
    return false;
  }
};

export const addOrUpdateBulkClients = async (clientsToProcess: Partial<Client>[]): Promise<{ addedCount: number; updatedCount: number }> => {
  let addedCount = 0;
  let updatedCount = 0;

  for (const clientData of clientsToProcess) {
    if (!clientData.name) continue;

    try {
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', clientData.name)
        .maybeSingle();

      if (existing) {
        const updateData: any = { updated_at: new Date().toISOString() };
        if (clientData.teamId !== undefined) updateData.team_id = clientData.teamId || null;
        if (clientData.insuranceRequirements !== undefined) updateData.insurance_requirements = clientData.insuranceRequirements;
        if (clientData.alliedHealthNeeds !== undefined) updateData.allied_health_needs = clientData.alliedHealthNeeds;

        await supabase
          .from('clients')
          .update(updateData)
          .eq('id', existing.id);

        updatedCount++;
      } else {
        await supabase
          .from('clients')
          .insert({
            name: clientData.name,
            team_id: clientData.teamId || null,
            insurance_requirements: clientData.insuranceRequirements || [],
            allied_health_needs: clientData.alliedHealthNeeds || []
          });

        addedCount++;
      }
    } catch (error) {
      console.error("Error processing client:", clientData.name, error);
    }
  }

  await loadClients();
  return { addedCount, updatedCount };
};

export const removeClientsByNames = async (clientNamesToRemove: string[]): Promise<{ removedCount: number }> => {
  let removedCount = 0;

  for (const name of clientNamesToRemove) {
    try {
      const { data } = await supabase
        .from('clients')
        .delete()
        .ilike('name', name)
        .select();

      if (data) removedCount += data.length;
    } catch (error) {
      console.error("Error removing client:", name, error);
    }
  }

  await loadClients();
  return { removedCount };
};

export const subscribeToClients = (listener: (clients: Client[]) => void): (() => void) => {
  listeners.push(listener);
  listener([..._clients]);

  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
};