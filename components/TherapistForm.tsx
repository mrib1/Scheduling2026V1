
import React, { useState } from 'react';
import { Therapist, TherapistFormProps, AlliedHealthServiceType, TherapistRole } from '../types';
import { ALL_ALLIED_HEALTH_SERVICES, ALL_THERAPIST_ROLES } from '../constants';
import { TrashIcon } from './icons/TrashIcon';
import SearchableMultiSelectDropdown from './SearchableMultiSelectDropdown';

const TherapistForm: React.FC<TherapistFormProps> = ({ therapist, availableTeams, availableInsuranceQualifications, onUpdate, onRemove }) => {
  const [formData, setFormData] = useState<Therapist>(therapist);

  const handleInputChange = (field: keyof Therapist, value: any) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onUpdate(newFormData);
  };
  
  const handleQualificationsChange = (selectedQualifications: string[]) => {
    handleInputChange('qualifications', selectedQualifications);
  };
  
  const handleAlliedHealthToggle = (service: AlliedHealthServiceType) => {
    const newServices = formData.canProvideAlliedHealth.includes(service)
      ? formData.canProvideAlliedHealth.filter(s => s !== service)
      : [...formData.canProvideAlliedHealth, service];
    handleInputChange('canProvideAlliedHealth', newServices);
  };

  return (
    <div className="bg-slate-50 p-6 rounded-lg shadow-md border border-slate-200 space-y-6">
      <div className="flex justify-between items-start mb-2">
        <input
            type="text"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className="text-xl font-semibold text-slate-700 p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full mr-4"
            placeholder="Therapist Name"
        />
        <button
          onClick={() => onRemove(therapist.id)}
          className="text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
          aria-label="Remove Therapist"
        >
          <TrashIcon className="w-6 h-6" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`role-${therapist.id}`} className="block text-sm font-medium text-slate-600 mb-1">Role:</label>
          <select
            id={`role-${therapist.id}`}
            value={formData.role || 'BT'}
            onChange={(e) => handleInputChange('role', e.target.value as TherapistRole)}
            className="form-select block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            {ALL_THERAPIST_ROLES.map(role => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`teamId-${therapist.id}`} className="block text-sm font-medium text-slate-600 mb-1">Team:</label>
          <select
            id={`teamId-${therapist.id}`}
            value={formData.teamId || ''}
            onChange={(e) => handleInputChange('teamId', e.target.value)}
            className="form-select block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Unassigned</option>
            {availableTeams.map(team => (
              <option key={team.id} value={team.id} style={{ color: team.color }}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div>
        <SearchableMultiSelectDropdown
            id={`therapist-qualifications-${therapist.id}`}
            label="Qualifications/Roles"
            options={availableInsuranceQualifications.map(q => q.id)}
            selectedOptions={formData.qualifications}
            onChange={handleQualificationsChange}
            placeholder="Search or select qualifications..."
            ariaLabel={`Qualifications for ${formData.name}`}
        />
         {availableInsuranceQualifications.length === 0 && (
             <p className="text-xs text-slate-500 mt-1">No qualification types defined in Settings.</p>
        )}
      </div>
      
      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">Can Provide Allied Health Services:</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ALL_ALLIED_HEALTH_SERVICES.map(service => (
            <label key={service} className="flex items-center space-x-2 p-1.5 border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.canProvideAlliedHealth.includes(service)}
                onChange={() => handleAlliedHealthToggle(service)}
                className="form-checkbox h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <span className="text-slate-700 text-sm">{service}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-sm text-slate-500 mt-4">
        Therapists are assumed to be available 8:45 AM - 5:15 PM, Monday to Friday. Maximum weekly hours are not currently enforced by the system. Only mandatory 30-minute lunch breaks will be scheduled as 'IndirectTime'.
      </p>
    </div>
  );
};

export default TherapistForm;
