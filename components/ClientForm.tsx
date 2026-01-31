
import React, { useState } from 'react';
import { Client, ClientFormProps, AlliedHealthNeed, AlliedHealthServiceType } from '../types';
import { TIME_SLOTS_H_MM, ALL_ALLIED_HEALTH_SERVICES, COMPANY_OPERATING_HOURS_START, COMPANY_OPERATING_HOURS_END } from '../constants';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';
import SearchableMultiSelectDropdown from './SearchableMultiSelectDropdown';
import { getClientColor } from '../utils/colorUtils';

const ClientForm: React.FC<ClientFormProps> = ({ client, availableTeams, availableInsuranceQualifications, onUpdate, onRemove }) => {
  const [formData, setFormData] = useState<Client>(client);

  const handleInputChange = (field: keyof Client, value: any) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onUpdate(newFormData);
  };
  
  const handleAlliedHealthChange = (index: number, field: keyof AlliedHealthNeed, value: any) => {
    const newAlliedHealthNeeds = [...formData.alliedHealthNeeds];
    (newAlliedHealthNeeds[index] as any)[field] = value;
     if (field === 'durationMinutes') {
        (newAlliedHealthNeeds[index] as any)[field] = parseInt(value,10) || 0;
    }
    if (field === 'frequencyPerWeek') {
        (newAlliedHealthNeeds[index]as any)[field] = parseInt(value,10) || 0;
    }
    handleInputChange('alliedHealthNeeds', newAlliedHealthNeeds);
  };

  const addAlliedHealthNeed = () => {
    const newNeed: AlliedHealthNeed = { type: 'OT', frequencyPerWeek: 1, durationMinutes: 30 };
    handleInputChange('alliedHealthNeeds', [...formData.alliedHealthNeeds, newNeed]);
  };

  const removeAlliedHealthNeed = (index: number) => {
    handleInputChange('alliedHealthNeeds', formData.alliedHealthNeeds.filter((_, i) => i !== index));
  };
  
  const handleInsuranceRequirementsChange = (selectedRequirements: string[]) => {
    handleInputChange('insuranceRequirements', selectedRequirements);
  };

  const clientColor = formData.color || getClientColor(client.id);

  return (
    <div className="bg-slate-50 p-6 rounded-lg shadow-md border border-slate-200 space-y-6">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center space-x-3 w-full mr-4">
          <div className="relative group">
            <input
              type="color"
              value={clientColor}
              onChange={(e) => handleInputChange('color', e.target.value)}
              className="w-8 h-8 rounded-full border border-slate-300 shadow-sm cursor-pointer overflow-hidden p-0"
              style={{ backgroundColor: clientColor }}
              title="Customize schedule block color"
            />
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
              Customize Color
            </div>
          </div>
          <input
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="text-xl font-semibold text-slate-700 p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
              placeholder="Client Name"
          />
        </div>
        <button
          onClick={() => onRemove(client.id)}
          className="text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
          aria-label="Remove Client"
        >
          <TrashIcon className="w-6 h-6" />
        </button>
      </div>

      <div>
          <label htmlFor={`teamId-${client.id}`} className="block text-sm font-medium text-slate-600 mb-1">Team:</label>
          <select
            id={`teamId-${client.id}`}
            value={formData.teamId || ''}
            onChange={(e) => handleInputChange('teamId', e.target.value)}
            className="form-select block w-full sm:w-1/2 p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Unassigned</option>
            {availableTeams.map(team => (
              <option key={team.id} value={team.id} style={{ color: team.color }}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

      <p className="text-sm text-slate-500">
        Clients are assumed to require coverage Monday-Friday, 9 AM - 5 PM. 
        Allied Health needs will be scheduled additionally.
        The primary therapist is considered the BCBA on the client's assigned team.
      </p>
      
      <div>
        <SearchableMultiSelectDropdown
            id={`client-insurance-reqs-${client.id}`}
            label="Insurance Requirements"
            options={availableInsuranceQualifications}
            selectedOptions={formData.insuranceRequirements}
            onChange={handleInsuranceRequirementsChange}
            placeholder="Search or select requirements..."
            ariaLabel={`Insurance requirements for ${formData.name}`}
        />
        {availableInsuranceQualifications.length === 0 && (
             <p className="text-xs text-slate-500 mt-1">No insurance/qualification types defined in Settings.</p>
        )}
      </div>

      <div>
        <h4 className="text-md font-medium text-slate-600 mb-2">Allied Health Needs:</h4>
        {formData.alliedHealthNeeds.map((need, index) => (
          <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center mb-3 p-3 border border-slate-200 rounded-md">
            <select value={need.type} onChange={(e) => handleAlliedHealthChange(index, 'type', e.target.value as AlliedHealthServiceType)} className="form-select block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"> {ALL_ALLIED_HEALTH_SERVICES.map(type => <option key={type} value={type}>{type}</option>)} </select>
            <input type="number" placeholder="Freq/Week" value={need.frequencyPerWeek} onChange={(e) => handleAlliedHealthChange(index, 'frequencyPerWeek', e.target.value)} className="form-input block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" min="0"/>
            <input type="number" placeholder="Mins/Session" value={need.durationMinutes} onChange={(e) => handleAlliedHealthChange(index, 'durationMinutes', e.target.value)} className="form-input block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" min="15" step="15"/>
             <div className="col-span-1 md:col-span-1">
                <label className="text-xs text-slate-500">Pref. Time (optional)</label>
                 <div className="flex space-x-1">
                    <select
                        value={need.preferredTimeSlot?.startTime || ""}
                        onChange={(e) => handleAlliedHealthChange(index, 'preferredTimeSlot', { ...need.preferredTimeSlot, startTime: e.target.value || COMPANY_OPERATING_HOURS_START })}
                        className="form-select block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-xs"
                    >
                        <option value="">Start</option>
                        {TIME_SLOTS_H_MM.map(time => <option key={`pref-start-${time}`} value={time}>{time}</option>)}
                    </select>
                    <select
                        value={need.preferredTimeSlot?.endTime || ""}
                        onChange={(e) => handleAlliedHealthChange(index, 'preferredTimeSlot', { ...need.preferredTimeSlot, endTime: e.target.value || COMPANY_OPERATING_HOURS_END })}
                        className="form-select block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-xs"
                    >
                         <option value="">End</option>
                        {TIME_SLOTS_H_MM.map(time => <option key={`pref-end-${time}`} value={time}>{time}</option>)}
                    </select>
                 </div>
            </div>
            <button onClick={() => removeAlliedHealthNeed(index)} className="text-red-500 hover:text-red-700 transition-colors p-2 justify-self-end md:justify-self-center" aria-label="Remove Allied Health Need"> <TrashIcon className="w-5 h-5" /> </button>
          </div>
        ))}
        <button onClick={addAlliedHealthNeed} className="mt-2 bg-sky-500 hover:bg-sky-600 text-white font-medium py-2 px-3 rounded-md shadow hover:shadow-sm transition-colors duration-150 flex items-center space-x-1 text-sm"> <PlusIcon className="w-4 h-4" /> <span>Add Allied Health Need</span> </button>
      </div>
    </div>
  );
};

export default ClientForm;
