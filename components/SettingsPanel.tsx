
import React, { useState } from 'react';
import { SettingsPanelProps, Team, InsuranceQualification } from '../types';
import { TEAM_COLORS } from '../constants';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';
import { EditIcon } from './icons/EditIcon';

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  availableTeams,
  availableInsuranceQualifications,
  onUpdateTeams,
  onUpdateInsuranceQualifications,
}) => {
  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');

  const [newIQ, setNewIQ] = useState('');
  const [editingIQ, setEditingIQ] = useState<InsuranceQualification | null>(null);

  const handleAddTeam = () => {
    if (newTeamName.trim() === '') return;
    const nextColorIndex = availableTeams.length % TEAM_COLORS.length;
    const newTeam: Team = {
      id: `team-${Date.now()}`,
      name: newTeamName.trim(),
      color: TEAM_COLORS[nextColorIndex],
    };
    onUpdateTeams([...availableTeams, newTeam]);
    setNewTeamName('');
  };

  const handleRemoveTeam = (teamId: string) => {
    onUpdateTeams(availableTeams.filter(team => team.id !== teamId));
  };

  const handleStartEditTeam = (team: Team) => {
    setEditingTeam(team);
    setEditingTeamName(team.name);
  };

  const handleSaveEditTeam = () => {
    if (editingTeam && editingTeamName.trim() !== '') {
      onUpdateTeams(
        availableTeams.map(team =>
          team.id === editingTeam.id ? { ...team, name: editingTeamName.trim() } : team
        )
      );
    }
    setEditingTeam(null);
    setEditingTeamName('');
  };

  const handleAddIQ = () => {
    if (newIQ.trim() === '' || availableInsuranceQualifications.some(iq => iq.id === newIQ.trim())) return;
    onUpdateInsuranceQualifications([...availableInsuranceQualifications, { id: newIQ.trim() }]);
    setNewIQ('');
  };

  const handleRemoveIQ = (idToRemove: string) => {
    onUpdateInsuranceQualifications(availableInsuranceQualifications.filter(iq => iq.id !== idToRemove));
  };

  const handleUpdateIQField = (id: string, field: keyof InsuranceQualification, value: any) => {
    const updated = availableInsuranceQualifications.map(iq => {
        if (iq.id === id) {
            return { ...iq, [field]: value === '' ? undefined : (typeof value === 'string' ? parseInt(value) : value) };
        }
        return iq;
    });
    onUpdateInsuranceQualifications(updated);
  };

  return (
    <div className="space-y-10 p-4 bg-white rounded-lg shadow-md">
      {/* Teams Management */}
      <section>
        <h2 className="text-xl font-semibold text-slate-700 mb-4 border-b pb-2">Manage Teams</h2>
        <div className="mb-6 space-y-3 md:space-y-0 md:flex md:items-end md:space-x-3">
          <div className="flex-grow">
            <label htmlFor="newTeamName" className="block text-sm font-medium text-slate-600 mb-1">New Team Name:</label>
            <input
              type="text"
              id="newTeamName"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="form-input block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Clinical Ninjas"
            />
          </div>
          <button
            onClick={handleAddTeam}
            className="w-full md:w-auto bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:shadow-md transition-colors duration-150 flex items-center justify-center space-x-2"
          >
            <PlusIcon className="w-5 h-5" />
            <span>Add Team</span>
          </button>
        </div>

        {availableTeams.length > 0 && (
          <ul className="space-y-3">
            {availableTeams.map(team => (
              <li key={team.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-md border border-slate-200 shadow-sm">
                {editingTeam?.id === team.id ? (
                  <div className="flex-grow flex items-center space-x-2">
                    <input
                      type="text"
                      value={editingTeamName}
                      onChange={(e) => setEditingTeamName(e.target.value)}
                      className="form-input p-1 border border-blue-300 rounded-md flex-grow"
                    />
                    <button onClick={handleSaveEditTeam} className="text-green-600 hover:text-green-800 p-1">Save</button>
                    <button onClick={() => setEditingTeam(null)} className="text-slate-500 hover:text-slate-700 p-1">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-3">
                    <span style={{ backgroundColor: team.color }} className="w-5 h-5 rounded-full border border-slate-300"></span>
                    <span className="text-slate-700 font-medium">{team.name}</span>
                  </div>
                )}
                {!editingTeam || editingTeam.id !== team.id ? (
                    <div className="space-x-2">
                        <button onClick={() => handleStartEditTeam(team)} className="text-blue-500 hover:text-blue-700" aria-label="Edit Team">
                            <EditIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => handleRemoveTeam(team.id)} className="text-red-500 hover:text-red-700" aria-label="Remove Team">
                            <TrashIcon className="w-5 h-5" />
                        </button>
                    </div>
                ): null}
              </li>
            ))}
          </ul>
        )}
         {availableTeams.length === 0 && <p className="text-slate-500 text-center py-3">No teams defined yet.</p>}
      </section>

      {/* Insurance/Qualifications Management */}
      <section>
        <h2 className="text-xl font-semibold text-slate-700 mb-4 border-b pb-2">Manage Insurance & Qualification Types</h2>
        <div className="mb-6 space-y-3 md:space-y-0 md:flex md:items-end md:space-x-3">
          <div className="flex-grow">
            <label htmlFor="newIQ" className="block text-sm font-medium text-slate-600 mb-1">New Type (Insurance or Credential):</label>
            <input
              type="text"
              id="newIQ"
              value={newIQ}
              onChange={(e) => setNewIQ(e.target.value)}
              className="form-input block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., MD_MEDICAID, TRICARE, or RBT"
            />
          </div>
          <button
            onClick={handleAddIQ}
            className="w-full md:w-auto bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:shadow-md transition-colors duration-150 flex items-center justify-center space-x-2"
          >
            <PlusIcon className="w-5 h-5" />
            <span>Add Type</span>
          </button>
        </div>

        {availableInsuranceQualifications.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type / ID</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role Hierarchy</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Max Providers/Day</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Min Session (Min)</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Max Session (Min)</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Max Hours/Week</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {availableInsuranceQualifications.map(iq => (
                  <tr key={iq.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">{iq.id}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <select
                        value={iq.roleHierarchyOrder ?? ''}
                        onChange={(e) => handleUpdateIQField(iq.id, 'roleHierarchyOrder', e.target.value === '' ? undefined : parseInt(e.target.value))}
                        className="text-sm border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Default</option>
                        <option value="0">BT (0)</option>
                        <option value="1">RBT (1)</option>
                        <option value="2">STAR 1 (2)</option>
                        <option value="3">STAR 2 (3)</option>
                        <option value="4">STAR 3 (4)</option>
                        <option value="5">CF (5)</option>
                        <option value="6">BCBA (6)</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="number"
                        value={iq.maxTherapistsPerDay ?? ''}
                        onChange={(e) => handleUpdateIQField(iq.id, 'maxTherapistsPerDay', e.target.value)}
                        className="w-20 text-sm border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="N/A"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="number"
                        value={iq.maxSessionDurationMinutes ?? ''}
                        onChange={(e) => handleUpdateIQField(iq.id, 'maxSessionDurationMinutes', e.target.value)}
                        className="w-20 text-sm border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="N/A"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="number"
                        value={iq.minSessionDurationMinutes ?? ''}
                        onChange={(e) => handleUpdateIQField(iq.id, 'minSessionDurationMinutes', e.target.value)}
                        className="w-20 text-sm border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="N/A"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="number"
                        value={iq.maxHoursPerWeek ?? ''}
                        onChange={(e) => handleUpdateIQField(iq.id, 'maxHoursPerWeek', e.target.value)}
                        className="w-20 text-sm border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="N/A"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleRemoveIQ(iq.id)} className="text-red-500 hover:text-red-700 ml-4" aria-label={`Remove ${iq.id}`}>
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {availableInsuranceQualifications.length === 0 && <p className="text-slate-500 text-center py-3">No insurance/qualification types defined yet.</p>}
      </section>
    </div>
  );
};

export default SettingsPanel;
