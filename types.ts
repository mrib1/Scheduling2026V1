
export enum DayOfWeek {
  MONDAY = "Monday",
  TUESDAY = "Tuesday",
  WEDNESDAY = "Wednesday",
  THURSDAY = "Thursday",
  FRIDAY = "Friday",
  SATURDAY = "Saturday",
  SUNDAY = "Sunday",
}

export interface Team {
  id: string;
  name: string;
  color: string;
}

export type AlliedHealthServiceType = 'OT' | 'SLP';
export type SessionType = 'ABA' | 'AlliedHealth_OT' | 'AlliedHealth_SLP' | 'IndirectTime' | 'AdminTime';
export type TherapistRole = "RBT" | "BCBA" | "Clinical Fellow" | "3 STAR" | "Technician" | "BT" | "Other";


export interface AlliedHealthNeed {
  type: AlliedHealthServiceType;
  frequencyPerWeek: number;
  durationMinutes: number;
  preferredTimeSlot?: { startTime: string; endTime: string };
  specificDays?: DayOfWeek[];
}

export interface Client {
  id:string;
  name: string;
  teamId?: string;
  /**
   * List of qualifications a therapist must have to work with this client.
   * "MD_MEDICAID" is a special value checked by the validation rule MD_MEDICAID_LIMIT_VIOLATED.
   */
  insuranceRequirements: string[];
  alliedHealthNeeds: AlliedHealthNeed[];
}

export interface Therapist {
  id: string;
  name: string;
  role: TherapistRole;
  teamId?: string;
  qualifications: string[];
  canProvideAlliedHealth: AlliedHealthServiceType[];
}

export interface ScheduleEntry {
  id: string; // Unique ID for each entry
  clientName: string | null;
  clientId: string | null; // New: ID of the client
  therapistName: string;
  therapistId: string; // New: ID of the therapist
  day: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  sessionType: SessionType;
}

export type GeneratedSchedule = ScheduleEntry[];

export interface BaseScheduleConfig {
  id: string;
  name: string;
  appliesToDays: DayOfWeek[];
  schedule: GeneratedSchedule | null; // Schedule entries here should also be updated if we load them
}

export interface ClientFormProps {
  client: Client;
  therapists: Therapist[];
  availableTeams: Team[];
  availableInsuranceQualifications: string[];
  onUpdate: (updatedClient: Client) => void;
  onRemove: (clientId: string) => void;
}

export interface TherapistFormProps {
  therapist: Therapist;
  availableTeams: Team[];
  availableInsuranceQualifications: string[];
  onUpdate: (updatedTherapist: Therapist) => void;
  onRemove: (therapistId: string) => void;
}

export interface SettingsPanelProps {
  availableTeams: Team[];
  availableInsuranceQualifications: string[];
  onUpdateTeams: (updatedTeams: Team[]) => void;
  onUpdateInsuranceQualifications: (updatedIQs: string[]) => void;
}

export interface ScheduleViewProps {
  schedule: GeneratedSchedule;
  therapists: Therapist[]; // These are the *displayed* therapists
  availableTeams: Team[];
  scheduledFullDate: Date | null;
  onMoveScheduleEntry: (draggedEntryId: string, newTherapistId: string, newStartTime: string) => void;
  onOpenEditSessionModal: (entry: ScheduleEntry) => void;
  onOpenAddSessionModal: (therapistId: string, therapistName: string, startTime: string, day: DayOfWeek) => void;
}

export interface ValidationError {
  ruleId: string;
  message: string;
  details?: Record<string, any>;
}

export interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: ScheduleEntry) => void;
  onDelete?: (entry: ScheduleEntry) => void;
  sessionData: ScheduleEntry | null; // If editing, this is the entry
  newSessionSlot: { therapistId: string; therapistName: string; startTime: string; day: DayOfWeek } | null; // If adding new
  clients: Client[];
  therapists: Therapist[];
  availableSessionTypes: string[];
  timeSlots: string[];
  currentSchedule: GeneratedSchedule;
  currentError: ValidationError[] | null;
  clearError: () => void;
}

export interface BaseScheduleManagerProps {
    baseSchedules: BaseScheduleConfig[];
    onAddConfig: () => void;
    onUpdateConfigName: (id: string, newName: string) => void;
    onUpdateConfigDays: (id: string, newDays: DayOfWeek[]) => void;
    onDeleteConfig: (id: string) => void;
    onSetAsBase: (id: string) => void;
    onViewBase: (id: string) => void;
    currentGeneratedScheduleIsSet: boolean;
}

export interface FilterControlsProps {
  allTeams: Team[];
  allTherapists: Therapist[];
  allClients: Client[];
  selectedTeamIds: string[];
  selectedTherapistIds: string[];
  selectedClientIds: string[];
  onTeamFilterChange: (ids: string[]) => void;
  onTherapistFilterChange: (ids: string[]) => void;
  onClientFilterChange: (ids: string[]) => void;
  onClearFilters: () => void;
}

export interface SearchableMultiSelectDropdownProps {
  label: string;
  options: string[];
  selectedOptions: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}

// Updated Callout Types for date range
export interface Callout {
  id: string;
  entityType: 'client' | 'therapist';
  entityId: string;
  entityName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (same as startDate for single day)
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  reason?: string;
}

export interface CalloutFormValues {
  entityType: 'client' | 'therapist';
  entityId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  reason?: string;
}

export interface BulkOperationError {
  rowNumber: number;
  message: string;
  rowData?: string; // Original row data that caused the error
}

export interface BulkOperationSummary {
  processedRows: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  errorCount: number;
  errors: BulkOperationError[];
  newlyAddedSettings?: {
    insuranceRequirements?: string[];
    qualifications?: string[];
  };
}

export interface AdminSettingsPanelProps {
  availableTeams: Team[];
  onBulkUpdateClients: (file: File, action: 'ADD_UPDATE' | 'REMOVE') => Promise<BulkOperationSummary>;
  onBulkUpdateTherapists: (file: File, action: 'ADD_UPDATE' | 'REMOVE') => Promise<BulkOperationSummary>;
  onUpdateInsuranceQualifications: (newQualifications: string[]) => void;
}

export interface GAGenerationResult {
  schedule: GeneratedSchedule | null;
  finalValidationErrors: ValidationError[];
  generations: number;
  bestFitness: number;
  success: boolean;
  statusMessage: string;
}