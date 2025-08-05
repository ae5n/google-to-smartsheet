import React, { useState, useEffect } from 'react';
import { googleAPI, smartsheetAPI, transferAPI } from '../services/api';
import { GoogleSheet, SmartsheetSheet, SmartsheetWorkspace, SmartsheetFolder, ColumnMapping } from '../types';
import toast from 'react-hot-toast';

interface TransferWizardProps {
  onJobCreated?: (jobId: string) => void;
}

type WizardStep = 'google-selection' | 'smartsheet-target' | 'column-mapping' | 'preview' | 'execution';

const TransferWizard: React.FC<TransferWizardProps> = ({ onJobCreated }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('google-selection');
  const [loading, setLoading] = useState(false);

  // Google Sheets data
  const [googleSheets, setGoogleSheets] = useState<GoogleSheet[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<GoogleSheet | null>(null);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);

  // Smartsheet data  
  const [workspaces, setWorkspaces] = useState<SmartsheetWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<SmartsheetWorkspace | null>(null);
  const [folders, setFolders] = useState<SmartsheetFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<SmartsheetFolder | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [createNewFolder, setCreateNewFolder] = useState(false);
  
  const [targetOption, setTargetOption] = useState<'new' | 'existing'>('new');
  const [newSheetName, setNewSheetName] = useState('');
  const [existingSheets, setExistingSheets] = useState<SmartsheetSheet[]>([]);
  const [selectedExistingSheet, setSelectedExistingSheet] = useState<SmartsheetSheet | null>(null);

  // Column mapping
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [googleHeaders, setGoogleHeaders] = useState<string[]>([]);

  useEffect(() => {
    loadGoogleSheets();
    loadWorkspaces();
    if (targetOption === 'existing') {
      loadExistingSheets();
    }
  }, [targetOption]);

  useEffect(() => {
    if (selectedWorkspace) {
      loadWorkspaceFolders(selectedWorkspace.id);
    }
  }, [selectedWorkspace]);

  const loadGoogleSheets = async () => {
    try {
      setLoading(true);
      const response = await googleAPI.getSpreadsheets();
      if (response.data.success) {
        setGoogleSheets(response.data.data || []);
      } else {
        toast.error('Failed to load Google Sheets');
      }
    } catch (error) {
      toast.error('Failed to load Google Sheets');
      console.error('Error loading Google sheets:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaces = async () => {
    try {
      const response = await smartsheetAPI.getWorkspaces();
      if (response.data.success) {
        setWorkspaces(response.data.data || []);
      } else {
        toast.error('Failed to load workspaces');
      }
    } catch (error) {
      toast.error('Failed to load workspaces');
      console.error('Error loading workspaces:', error);
    }
  };

  const loadWorkspaceFolders = async (workspaceId: number) => {
    try {
      const response = await smartsheetAPI.getWorkspaceFolders(workspaceId);
      if (response.data.success) {
        setFolders(response.data.data || []);
      } else {
        toast.error('Failed to load folders');
      }
    } catch (error) {
      toast.error('Failed to load folders');
      console.error('Error loading folders:', error);
    }
  };

  const loadExistingSheets = async () => {
    try {
      const response = await smartsheetAPI.getSheets();
      if (response.data.success) {
        setExistingSheets(response.data.data || []);
      } else {
        toast.error('Failed to load existing sheets');
      }
    } catch (error) {
      toast.error('Failed to load existing sheets');
      console.error('Error loading existing sheets:', error);
    }
  };

  const handleCreateFolder = async () => {
    if (!selectedWorkspace || !newFolderName.trim()) {
      toast.error('Please select a workspace and enter a folder name');
      return;
    }

    try {
      setLoading(true);
      const response = await smartsheetAPI.createFolder(selectedWorkspace.id, newFolderName.trim());
      if (response.data.success) {
        const newFolder = response.data.data;
        setFolders([...folders, newFolder]);
        setSelectedFolder(newFolder);
        setNewFolderName('');
        setCreateNewFolder(false);
        toast.success('Folder created successfully');
      } else {
        toast.error('Failed to create folder');
      }
    } catch (error) {
      toast.error('Failed to create folder');
      console.error('Error creating folder:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleHeaders = async () => {
    if (!selectedSpreadsheet || selectedTabs.length === 0) return;

    try {
      const response = await googleAPI.getSpreadsheetHeaders(selectedSpreadsheet.spreadsheetId, selectedTabs[0]);
      if (response.data.success) {
        setGoogleHeaders(response.data.data || []);
      }
    } catch (error) {
      console.error('Error loading headers:', error);
    }
  };

  const canProceedFromStep = (step: WizardStep): boolean => {
    switch (step) {
      case 'google-selection':
        return selectedSpreadsheet !== null && selectedTabs.length > 0;
      case 'smartsheet-target':
        if (targetOption === 'new') {
          return newSheetName.trim() !== '' && selectedWorkspace !== null;
        } else {
          return selectedExistingSheet !== null;
        }
      case 'column-mapping':
        return columnMappings.length > 0;
      case 'preview':
        return true;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    const steps: WizardStep[] = ['google-selection', 'smartsheet-target', 'column-mapping', 'preview', 'execution'];
    const currentIndex = steps.indexOf(currentStep);
    
    if (currentStep === 'google-selection' && canProceedFromStep(currentStep)) {
      await loadGoogleHeaders();
    }
    
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const handlePrevious = () => {
    const steps: WizardStep[] = ['google-selection', 'smartsheet-target', 'column-mapping', 'preview', 'execution'];
    const currentIndex = steps.indexOf(currentStep);
    
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  const renderGoogleSelectionStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Select Google Sheet</h3>
        {loading ? (
          <div className="text-center py-4">Loading spreadsheets...</div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {googleSheets.map((sheet) => (
              <div
                key={sheet.spreadsheetId}
                className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                  selectedSpreadsheet?.spreadsheetId === sheet.spreadsheetId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200'
                }`}
                onClick={() => setSelectedSpreadsheet(sheet)}
              >
                <div className="font-medium">{sheet.title}</div>
                <div className="text-sm text-gray-500">{sheet.sheets.length} tabs</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedSpreadsheet && (
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Select Tabs to Transfer</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {selectedSpreadsheet.sheets.map((tab) => (
              <label key={tab.sheetId} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={selectedTabs.includes(tab.title)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTabs([...selectedTabs, tab.title]);
                    } else {
                      setSelectedTabs(selectedTabs.filter(t => t !== tab.title));
                    }
                  }}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">{tab.title}</span>
                <span className="text-xs text-gray-500">
                  ({tab.gridProperties.rowCount} rows, {tab.gridProperties.columnCount} columns)
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderSmartsheetTargetStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Smartsheet Target</h3>
        
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="targetOption"
                value="new"
                checked={targetOption === 'new'}
                onChange={(e) => setTargetOption(e.target.value as 'new' | 'existing')}
                className="border-gray-300"
              />
              <span>Create new sheet</span>
            </label>
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="targetOption"
                value="existing"
                checked={targetOption === 'existing'}
                onChange={(e) => setTargetOption(e.target.value as 'new' | 'existing')}
                className="border-gray-300"
              />
              <span>Use existing sheet</span>
            </label>
          </div>
        </div>
      </div>

      {targetOption === 'new' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sheet Name
            </label>
            <input
              type="text"
              value={newSheetName}
              onChange={(e) => setNewSheetName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter new sheet name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Workspace
            </label>
            <select
              value={selectedWorkspace?.id || ''}
              onChange={(e) => {
                const workspace = workspaces.find(w => w.id === parseInt(e.target.value));
                setSelectedWorkspace(workspace || null);
                setSelectedFolder(null);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>

          {selectedWorkspace && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Folder (Optional)
                </label>
                <button
                  type="button"
                  onClick={() => setCreateNewFolder(!createNewFolder)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {createNewFolder ? 'Cancel' : 'Create New Folder'}
                </button>
              </div>

              {createNewFolder ? (
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter folder name"
                  />
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    disabled={loading || !newFolderName.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              ) : (
                <select
                  value={selectedFolder?.id || ''}
                  onChange={(e) => {
                    const folder = folders.find(f => f.id === parseInt(e.target.value));
                    setSelectedFolder(folder || null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No folder (workspace root)</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {targetOption === 'existing' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Select Existing Sheet
          </label>
          <select
            value={selectedExistingSheet?.id || ''}
            onChange={(e) => {
              const sheet = existingSheets.find(s => s.id === parseInt(e.target.value));
              setSelectedExistingSheet(sheet || null);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select sheet</option>
            {existingSheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  const renderColumnMappingStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Column Mapping</h3>
        <p className="text-sm text-gray-600 mb-4">
          Map columns from your Google Sheet to Smartsheet columns. This step will be enhanced with actual mapping interface.
        </p>
        
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Google Sheet Headers:</h4>
          <div className="flex flex-wrap gap-2">
            {googleHeaders.map((header, index) => (
              <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-sm">
                {header}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              // Create basic mappings for now
              const mappings: ColumnMapping[] = googleHeaders.map((header, index) => ({
                googleColumn: header,
                smartsheetColumnId: index + 1,
                dataType: 'text'
              }));
              setColumnMappings(mappings);
              toast.success('Basic column mappings created');
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Create Basic Mappings
          </button>
        </div>

        {columnMappings.length > 0 && (
          <div className="mt-4 bg-green-50 p-4 rounded-lg">
            <h4 className="font-medium mb-2">Mappings Created:</h4>
            <p className="text-sm text-green-700">{columnMappings.length} column mappings configured</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderPreviewStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Transfer Preview</h3>
        
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <span className="font-medium">Source:</span> {selectedSpreadsheet?.title}
          </div>
          <div>
            <span className="font-medium">Tabs:</span> {selectedTabs.join(', ')}
          </div>
          <div>
            <span className="font-medium">Target:</span> 
            {targetOption === 'new' 
              ? ` New sheet "${newSheetName}" in ${selectedWorkspace?.name}${selectedFolder ? ` > ${selectedFolder.name}` : ''}`
              : ` Existing sheet "${selectedExistingSheet?.name}"`
            }
          </div>
          <div>
            <span className="font-medium">Column Mappings:</span> {columnMappings.length}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setCurrentStep('execution')}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Start Transfer
          </button>
        </div>
      </div>
    </div>
  );

  const renderExecutionStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Transfer Execution</h3>
        <div className="bg-blue-50 p-4 rounded-lg">
          <p className="text-blue-800">Transfer execution functionality will be implemented here.</p>
          <p className="text-sm text-blue-600 mt-2">This will include progress tracking and real-time updates.</p>
        </div>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'google-selection':
        return renderGoogleSelectionStep();
      case 'smartsheet-target':
        return renderSmartsheetTargetStep();
      case 'column-mapping':
        return renderColumnMappingStep();
      case 'preview':
        return renderPreviewStep();
      case 'execution':
        return renderExecutionStep();
      default:
        return null;
    }
  };

  const getStepNumber = (step: WizardStep): number => {
    const steps: WizardStep[] = ['google-selection', 'smartsheet-target', 'column-mapping', 'preview', 'execution'];
    return steps.indexOf(step) + 1;
  };

  const getStepTitle = (step: WizardStep): string => {
    const titles = {
      'google-selection': 'Select Google Sheet',
      'smartsheet-target': 'Choose Target',
      'column-mapping': 'Map Columns',
      'preview': 'Preview & Confirm',
      'execution': 'Transfer Data'
    };
    return titles[step];
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Progress bar */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Transfer Wizard</h2>
            <div className="text-sm text-gray-500">
              Step {getStepNumber(currentStep)} of 5 - {getStepTitle(currentStep)}
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(getStepNumber(currentStep) / 5) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="px-6 py-6">
          {renderCurrentStep()}
        </div>

        {/* Navigation */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentStep === 'google-selection'}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          
          <button
            type="button"
            onClick={handleNext}
            disabled={!canProceedFromStep(currentStep) || currentStep === 'execution'}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {currentStep === 'preview' ? 'Start Transfer' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferWizard;