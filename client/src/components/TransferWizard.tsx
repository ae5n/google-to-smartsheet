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

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState('');
  const [createdSheet, setCreatedSheet] = useState<SmartsheetSheet | null>(null);

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
      setLoading(true);
      const response = await googleAPI.getSpreadsheetHeaders(selectedSpreadsheet.spreadsheetId, selectedTabs[0]);
      if (response.data.success) {
        const headers = response.data.data || [];
        setGoogleHeaders(headers);
      } else {
        console.error('Failed to load headers:', response.data.error);
        toast.error('Failed to load spreadsheet headers');
      }
    } catch (error) {
      console.error('Error loading headers:', error);
      toast.error('Failed to load spreadsheet headers');
    } finally {
      setLoading(false);
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

  const sanitizeColumnTitle = (header: string, index: number, allHeaders: string[]): string => {
    if (!header || !header.trim()) {
      return `Column ${index + 1}`;
    }

    let sanitized = header.trim();
    
    // Limit length to 50 characters (Smartsheet limit)
    if (sanitized.length > 50) {
      sanitized = sanitized.substring(0, 47) + '...';
    }
    
    // Replace problematic characters
    sanitized = sanitized.replace(/[<>]/g, ''); // Remove < >
    sanitized = sanitized.replace(/\s+/g, ' '); // Normalize whitespace
    
    if (!sanitized) {
      return `Column ${index + 1}`;
    }
    
    // Handle duplicates by adding incremental numbers
    const headersBeforeThis = allHeaders.slice(0, index);
    let finalTitle = sanitized;
    let counter = 2; // Start with 2 for the first duplicate
    
    while (headersBeforeThis.includes(finalTitle)) {
      finalTitle = `${sanitized} ${counter}`;
      counter++;
      
      // Ensure we don't exceed length limit with the counter
      if (finalTitle.length > 50) {
        const suffix = ` ${counter - 1}`;
        const baseLength = 50 - suffix.length;
        finalTitle = `${sanitized.substring(0, baseLength)}${suffix}`;
        break;
      }
    }
    
    return finalTitle;
  };

  const executeTransfer = async () => {
    if (!selectedSpreadsheet || selectedTabs.length === 0) {
      toast.error('Missing Google Sheet selection');
      return;
    }

    if (googleHeaders.length === 0) {
      toast.error('No headers found in Google Sheet. Please ensure your sheet has header rows.');
      return;
    }

    setIsExecuting(true);
    setExecutionStep('Preparing transfer...');

    try {
      let targetSheet: SmartsheetSheet;

      if (targetOption === 'new') {
        if (!newSheetName.trim() || !selectedWorkspace) {
          toast.error('Missing sheet name or workspace selection');
          return;
        }

        setExecutionStep('Creating new Smartsheet...');
        
        // Create basic columns based on Google headers, filtering out empty titles
        const columns = googleHeaders
          .map((header, index) => ({
            title: sanitizeColumnTitle(header, index, googleHeaders),
            type: 'TEXT_NUMBER' as const,
            primary: index === 0
          }))
          .filter(col => col.title.length > 0); // Ensure no empty titles

        // Ensure we have at least one column
        if (columns.length === 0) {
          columns.push({
            title: 'Column 1',
            type: 'TEXT_NUMBER' as const,
            primary: true
          });
        }

        console.log('Creating sheet:', newSheetName.trim());

        const response = await smartsheetAPI.createSheet(
          newSheetName.trim(),
          columns,
          selectedWorkspace.id,
          selectedFolder?.id
        );

        if (!response.data.success) {
          throw new Error(response.data.error || 'Failed to create Smartsheet');
        }

        targetSheet = response.data.data!;
        setCreatedSheet(targetSheet);
        
        // Create proper column mappings using actual Smartsheet column IDs
        const properMappings: ColumnMapping[] = [];
        let smartsheetColumnIndex = 0;
        
        for (let i = 0; i < googleHeaders.length; i++) {
          const header = googleHeaders[i];
          
          // Skip empty headers
          if (!header || !header.trim()) {
            continue;
          }
          
          // Get corresponding Smartsheet column
          const smartsheetColumn = targetSheet.columns[smartsheetColumnIndex];
          if (smartsheetColumn) {
            properMappings.push({
              googleColumn: header.trim(),
              smartsheetColumnId: smartsheetColumn.id,
              dataType: 'text' as const
            });
            smartsheetColumnIndex++;
          }
        }

        setColumnMappings(properMappings);
        console.log('✓ Column mappings created:', properMappings.length, 'mappings');
        
        toast.success('Smartsheet created successfully');
      } else {
        if (!selectedExistingSheet) {
          toast.error('No existing sheet selected');
          return;
        }
        targetSheet = selectedExistingSheet;
        
        // Create column mappings for existing sheet
        const existingMappings: ColumnMapping[] = [];
        let smartsheetColumnIndex = 0;
        
        for (let i = 0; i < googleHeaders.length; i++) {
          const header = googleHeaders[i];
          
          // Skip empty headers
          if (!header || !header.trim()) {
            continue;
          }
          
          // Get corresponding Smartsheet column
          const smartsheetColumn = targetSheet.columns[smartsheetColumnIndex];
          if (smartsheetColumn) {
            existingMappings.push({
              googleColumn: header.trim(),
              smartsheetColumnId: smartsheetColumn.id,
              dataType: 'text' as const
            });
            smartsheetColumnIndex++;
          }
        }

        setColumnMappings(existingMappings);
        console.log('✓ Column mappings created for existing sheet:', existingMappings.length, 'mappings');
      }

      setExecutionStep('Creating transfer job...');

      // Validate column mappings before creating job
      if (columnMappings.length === 0) {
        throw new Error('No valid column mappings found. Please check your Google Sheet headers.');
      }

      console.log('🚀 Creating transfer job:', {
        spreadsheet: selectedSpreadsheet.title,
        tabs: selectedTabs,
        targetSheet: targetSheet.name,
        mappingsCount: columnMappings.length
      });

      // Create transfer job
      const jobResponse = await transferAPI.createJob({
        googleSpreadsheetId: selectedSpreadsheet.spreadsheetId,
        googleSheetTabs: selectedTabs,
        smartsheetId: targetSheet.id,
        columnMappings: columnMappings,
        dryRun: false
      });

      if (!jobResponse.data.success) {
        throw new Error(jobResponse.data.error || 'Failed to create transfer job');
      }

      const jobId = jobResponse.data.data?.jobId;
      if (!jobId) {
        throw new Error('No job ID returned');
      }

      setExecutionStep('Transfer job created successfully!');
      toast.success('Transfer started successfully');
      
      // Wait a moment then redirect
      setTimeout(() => {
        if (onJobCreated) {
          onJobCreated(jobId);
        }
      }, 2000);

    } catch (error: any) {
      console.error('Transfer execution error:', error);
      
      let errorMessage = 'Failed to execute transfer';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.details) {
        errorMessage = `Validation error: ${error.response.data.details.map((d: any) => d.msg).join(', ')}`;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
      setExecutionStep(`Transfer failed: ${errorMessage}`);
    } finally {
      setIsExecuting(false);
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
            onClick={() => {
              setCurrentStep('execution');
              // Start execution immediately when moving to execution step
              setTimeout(executeTransfer, 500);
            }}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            disabled={loading}
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
        
        {isExecuting ? (
          <div className="bg-blue-50 p-6 rounded-lg">
            <div className="flex items-center space-x-3 mb-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-blue-800 font-medium">Executing Transfer...</span>
            </div>
            
            <div className="bg-white p-4 rounded-md border border-blue-200">
              <p className="text-sm text-gray-700">{executionStep}</p>
            </div>

            {createdSheet && (
              <div className="mt-4 bg-green-50 p-3 rounded-md border border-green-200">
                <p className="text-sm text-green-800">
                  ✓ New sheet created: <strong>{createdSheet.name}</strong>
                </p>
                <a 
                  href={createdSheet.permalink} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-green-600 hover:text-green-800 underline"
                >
                  View in Smartsheet →
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {executionStep.includes('failed') ? (
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="text-red-800">{executionStep}</p>
                <button
                  type="button"
                  onClick={executeTransfer}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Retry Transfer
                </button>
              </div>
            ) : executionStep.includes('successfully') ? (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <p className="text-green-800 font-medium">{executionStep}</p>
                <p className="text-sm text-green-700 mt-2">
                  Redirecting to job monitoring page...
                </p>
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700">Ready to start transfer...</p>
                <button
                  type="button"
                  onClick={executeTransfer}
                  className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Execute Transfer
                </button>
              </div>
            )}
          </div>
        )}
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