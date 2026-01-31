// MOCK SUPABASE CLIENT - Uses LocalStorage for data persistence
// Replaces the real Supabase connection to allow the app to run without backend credentials.

const STORAGE_KEY_PREFIX = 'aba_scheduler_db_';

const getStorage = () => {
  if (typeof localStorage !== 'undefined') return localStorage;
  if (typeof global !== 'undefined' && (global as any).localStorage) return (global as any).localStorage;
  return {
    getItem: (key: string) => null,
    setItem: (key: string, value: string) => {},
    removeItem: (key: string) => {}
  };
};

// Initial Sample Data
const initialTeams = [
  { id: 'team-1', name: 'Red Team', color: '#EF4444' },
  { id: 'team-2', name: 'Blue Team', color: '#3B82F6' },
  { id: 'team-3', name: 'Green Team', color: '#10B981' }
];

const initialTherapists = [
    { id: 't1', name: 'Breanne Hawkins', team_id: 'team-2', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't2', name: 'Ramsey Mahaffey', team_id: 'team-3', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't3', name: 'Britney Little', team_id: 'team-2', qualifications: ['BCBA','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't4', name: 'Amanda Lewis', team_id: 'team-1', qualifications: ['BCBA','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't5', name: 'Katie Marsico', team_id: 'team-2', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't6', name: 'Skyelar Mcleod', team_id: 'team-2', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't7', name: 'Renee Gilbert', team_id: 'team-2', qualifications:['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't8', name: 'Samantha Wheatley', team_id: 'team-3', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't9', name: 'Skylar Morley', team_id: 'team-2', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't10', name: 'Alexis Price', team_id: 'team-3', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't11', name: 'Courtney Edge', team_id: 'team-2', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't12', name: 'Adriana Lutzio', team_id: 'team-3', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't13', name: 'Sierra Hughes', team_id: 'team-3', qualifications: ['RBT','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't14', name: 'Hannah Holloway', team_id: 'team-3', qualifications: ['BLS','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't15', name: 'Alyssa Lidard', team_id: 'team-3', qualifications: ['BCBA','BLS','TRICARE','MD_MEDICAID'], can_provide_allied_health: []},
 { id: 't16', name: 'Brittany Pender', team_id: 'team-3', qualifications: ['BLS','MD_MEDICAID'], can_provide_allied_health: [] },
 { id: 't17', name: 'Izaiah Plaza', team_id: 'team-3', qualifications: ['MD_MEDICAID'],can_provide_allied_health: [] }


];

const initialClients = [
  { id: 'c1', name: 'JaxBri', team_id: 'team-2', insurance_requirements: ['MD_MEDICAID' ], allied_health_needs: [] },
 { id: 'c2', name: 'MarSul', team_id: 'team-2', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c3', name: 'AbeAbe', team_id: 'team-3', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c4', name: 'IsrOse', team_id: 'team-2', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c5', name: 'MadHna', team_id: 'team-2', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c6', name: 'FeyFag', team_id: 'team-2', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c7', name: 'NolGun', team_id: 'team-2', insurance_requirements: ['RBT','BLS'], allied_health_needs: [] },
 { id: 'c8', name: 'EsaOsb', team_id: 'team-1', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c9', name: 'AndMic', team_id: 'team-3', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c10', name: 'KilLuc', team_id: 'team-3', insurance_requirements: [ 'TRICARE' ,'RBT','BLS'], allied_health_needs: [] },
 { id: 'c11', name: 'AttFin', team_id: 'team-3', insurance_requirements: [], allied_health_needs: [] },
 { id: 'c12', name: 'MatFis', team_id: 'team-3', insurance_requirements: ['RBT','BLS'], allied_health_needs: [] },
 { id: 'c13', name: 'WilPet', team_id: 'team-1', insurance_requirements: [], allied_health_needs: [] }

];

const initialSettings = [
  { key: 'insurance_qualifications', value: ['RBT', 'BCBA', 'Clinical Fellow', 'MD_MEDICAID', 'OT Certified', 'SLP Certified'] }
];

class MockSupabase {
  public subscribers: Record<string, Function[]> = {};

  from(table: string) {
    return new QueryBuilder(table, this);
  }

  channel(name: string) {
    return {
      on: (type: string, config: any, callback: Function) => {
        const table = config.table;
        if (!this.subscribers[table]) this.subscribers[table] = [];
        this.subscribers[table].push(callback);
        return { subscribe: () => {} };
      }
    };
  }

  _notify(table: string) {
    if (this.subscribers[table]) {
      this.subscribers[table].forEach(cb => cb());
    }
  }
}

class QueryBuilder {
  private table: string;
  private client: MockSupabase;
  private filters: ((item: any) => boolean)[];
  private sorters: ((a: any, b: any) => number)[];
  private _limit: number | null;
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | null;
  private payload: any;
  private isSingle: boolean;
  private isMaybeSingle: boolean;

  constructor(table: string, client: MockSupabase) {
    this.table = table;
    this.client = client;
    this.filters = [];
    this.sorters = [];
    this._limit = null;
    this.action = null; 
    this.payload = null;
    this.isSingle = false;
    this.isMaybeSingle = false;

    // Initialize storage if needed
    const key = STORAGE_KEY_PREFIX + table;
    const storage = getStorage();
    if (!storage.getItem(key)) {
      let data: any[] = [];
      if (table === 'teams') data = initialTeams;
      else if (table === 'therapists') data = initialTherapists;
      else if (table === 'clients') data = initialClients;
      else if (table === 'settings') data = initialSettings;
      storage.setItem(key, JSON.stringify(data));
    }
  }

  select(columns?: string) {
    this.action = 'select';
    return this;
  }

  insert(row: any) {
    this.action = 'insert';
    this.payload = row;
    return this;
  }

  update(updates: any) {
    this.action = 'update';
    this.payload = updates;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  upsert(row: any, options?: any) {
    this.action = 'upsert';
    this.payload = { row, options };
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push(item => item[col] === val);
    return this;
  }

  ilike(col: string, val: string) {
    const regex = new RegExp(val, 'i');
    this.filters.push(item => regex.test(item[col]));
    return this;
  }

  gte(col: string, val: any) {
    this.filters.push(item => item[col] >= val);
    return this;
  }

  order(col: string, { ascending = true } = {}) {
    this.sorters.push((a, b) => {
      if (a[col] < b[col]) return ascending ? -1 : 1;
      if (a[col] > b[col]) return ascending ? 1 : -1;
      return 0;
    });
    return this;
  }

  limit(n: number) {
    this._limit = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  // Handle promise execution
  then(resolve: (value: { data: any, error: any }) => void, reject: (reason?: any) => void) {
    const key = STORAGE_KEY_PREFIX + this.table;
    const storage = getStorage();
    let allRows: any[] = [];
    try {
      const stored = storage.getItem(key);
      allRows = stored ? JSON.parse(stored) : [];
    } catch (e) {
      allRows = [];
    }

    let resultData: any = null;
    let error: any = null;

    try {
      if (this.action === 'insert') {
        const newRow = { ...this.payload, id: this.payload.id || `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
        allRows.push(newRow);
        storage.setItem(key, JSON.stringify(allRows));
        this.client._notify(this.table);
        resultData = newRow;
      } else if (this.action === 'update') {
        const idsToUpdate = allRows.filter(item => this.filters.every(f => f(item))).map(i => i.id);
        allRows = allRows.map(item => {
          if (idsToUpdate.includes(item.id)) {
            return { ...item, ...this.payload };
          }
          return item;
        });
        storage.setItem(key, JSON.stringify(allRows));
        this.client._notify(this.table);
        resultData = allRows.filter(item => idsToUpdate.includes(item.id));
      } else if (this.action === 'delete') {
        const idsToDelete = allRows.filter(item => this.filters.every(f => f(item))).map(i => i.id);
        const keptRows = allRows.filter(item => !idsToDelete.includes(item.id));
        const deletedRows = allRows.filter(item => idsToDelete.includes(item.id));
        storage.setItem(key, JSON.stringify(keptRows));
        this.client._notify(this.table);
        resultData = deletedRows;
      } else if (this.action === 'upsert') {
        const { row, options } = this.payload;
        const conflictKey = options?.onConflict || 'id';
        const existingIdx = allRows.findIndex(i => i[conflictKey] === row[conflictKey]);
        let newRow;
        if (existingIdx >= 0) {
          allRows[existingIdx] = { ...allRows[existingIdx], ...row };
          newRow = allRows[existingIdx];
        } else {
          newRow = { ...row, id: row.id || `mock-${Date.now()}` };
          allRows.push(newRow);
        }
        storage.setItem(key, JSON.stringify(allRows));
        this.client._notify(this.table);
        resultData = newRow;
      } else {
        // Select
        let rows = allRows.filter(item => this.filters.every(f => f(item)));
        this.sorters.forEach(sort => rows.sort(sort));
        if (this._limit !== null) {
          rows = rows.slice(0, this._limit);
        }
        resultData = rows;
      }

      if (this.isSingle) {
        if (Array.isArray(resultData)) {
          if (resultData.length === 0) error = { message: 'Row not found', code: 'PGRST116' };
          else if (resultData.length > 1) error = { message: 'Multiple rows found', code: 'PGRST116' };
          else resultData = resultData[0];
        } else if (Array.isArray(resultData) && resultData.length === 1) {
           resultData = resultData[0];
        }
      } else if (this.isMaybeSingle) {
        if (Array.isArray(resultData)) {
          if (resultData.length === 0) resultData = null;
          else if (resultData.length > 1) error = { message: 'Multiple rows found', code: 'PGRST116' };
          else resultData = resultData[0];
        }
      }

    } catch (err: any) {
      error = err;
    }

    resolve({ data: resultData, error });
  }
}

export const supabase = new MockSupabase();
