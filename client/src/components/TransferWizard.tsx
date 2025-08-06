import React, { useState, useEffect } from 'react';
import { googleAPI, smartsheetAPI, transferAPI } from '../services/api';
import { GoogleSheet, SmartsheetSheet, SmartsheetWorkspace, SmartsheetFolder, ColumnMapping } from '../types';
import toast from 'react-hot-toast';

interface TransferWizardProps {
  onJobCreated?: (jobId: string) => void;
}

type WizardStep = 'google-selection' | 'header-selection' | 'smartsheet-target' | 'preview' | 'execution';

const TransferWizard: React.FC<TransferWizardProps> = ({ onJobCreated }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('google-selection');
  const [loading, setLoading] = useState(false);

  // Google Sheets data
  const [googleSheets, setGoogleSheets] = useState<GoogleSheet[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<GoogleSheet | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>('');

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

  // Header selection
  const [headerPreview, setHeaderPreview] = useState<{
    rows: string[][];
    detectedHeaderRow: number;
    detectedHeaders: string[];
    rowOptions: Array<{ rowIndex: number; preview: string[]; score: number }>;
  } | null>(null);
  const [selectedHeaderRow, setSelectedHeaderRow] = useState<number>(0);
  const [selectedColumns, setSelectedColumns] = useState<number[]>([]);

  // Column mapping
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [googleHeaders, setGoogleHeaders] = useState<string[]>([]);

  // Row statistics
  const [rowStats, setRowStats] = useState<{
    totalRows: number;
    dataRows: number;
    headerRows: number;
  } | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState('');
  const [createdSheet, setCreatedSheet] = useState<SmartsheetSheet | null>(null);

  useEffect(() => {
    loadGoogleSheets();
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      loadWorkspaceFolders(selectedWorkspace.id);
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (targetOption === 'existing' && selectedFolder) {
      loadExistingSheets(selectedFolder.id);
    }
  }, [selectedFolder, targetOption]);

  useEffect(() => {
    if (currentStep === 'preview') {
      loadRowStatistics();
    }
  }, [currentStep, selectedSpreadsheet, selectedTab, selectedHeaderRow]);

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

  const loadExistingSheets = async (folderId?: number) => {
    try {
      const response = folderId 
        ? await smartsheetAPI.getFolderSheets(folderId)
        : await smartsheetAPI.getSheets();
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

  const loadHeaderPreview = async () => {
    if (!selectedSpreadsheet || !selectedTab) return;

    try {
      setLoading(true);
      const response = await googleAPI.getHeaderPreview(selectedSpreadsheet.spreadsheetId, selectedTab);
      if (response.data.success && response.data.data) {
        const preview = response.data.data;
        setHeaderPreview(preview);
        setSelectedHeaderRow(preview.detectedHeaderRow);
        setGoogleHeaders(preview.detectedHeaders);
        // Initialize selected columns - select all columns by default
        const allColumns = Array.from({ length: preview.detectedHeaders.length }, (_, i) => i);
        setSelectedColumns(allColumns);
      } else {
        console.error('Failed to load header preview:', response.data.error);
        toast.error('Failed to load header preview');
      }
    } catch (error) {
      console.error('Error loading header preview:', error);
      toast.error('Failed to load header preview');
    } finally {
      setLoading(false);
    }
  };

  const loadGoogleHeaders = async () => {
    if (!selectedSpreadsheet || !selectedTab) return;

    try {
      setLoading(true);
      const response = await googleAPI.getSpreadsheetHeaders(selectedSpreadsheet.spreadsheetId, selectedTab);
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

  const loadRowStatistics = async () => {
    if (!selectedSpreadsheet || !selectedTab || selectedHeaderRow < 0) return;

    try {
      // Get the actual data that will be transferred (same as backend uses)
      const response = await googleAPI.previewSpreadsheet(selectedSpreadsheet.spreadsheetId, [selectedTab]);
      
      if (response.data.success && response.data.data) {
        const previewData = response.data.data.preview;
        const tabData = previewData ? previewData[selectedTab] : null;
        
        if (tabData && Array.isArray(tabData)) {
          const actualRows = tabData.length; // This is what Google Sheets API returns (excludes empty rows)
          const headerRows = selectedHeaderRow + 1;
          const dataRowsToTransfer = Math.max(0, actualRows - headerRows);
          
          const stats = {
            totalRows: actualRows, // Total rows with data (matches backend behavior)
            dataRows: dataRowsToTransfer, // Data rows that will be transferred
            headerRows
          };
          
          console.log('Setting row stats (matches backend):', stats);
          setRowStats(stats);
        }
      }
    } catch (error) {
      console.error('Error loading row statistics:', error);
    }
  };

  const canProceedFromStep = (step: WizardStep): boolean => {
    switch (step) {
      case 'google-selection':
        return selectedSpreadsheet !== null && selectedTab !== '';
      case 'header-selection':
        return headerPreview !== null && selectedHeaderRow >= 0 && selectedColumns.length > 0;
      case 'smartsheet-target':
        if (targetOption === 'new') {
          return newSheetName.trim() !== '' && selectedWorkspace !== null;
        } else {
          return selectedExistingSheet !== null && selectedWorkspace !== null && selectedFolder !== null;
        }
      case 'preview':
        return true;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    const steps: WizardStep[] = ['google-selection', 'header-selection', 'smartsheet-target', 'preview', 'execution'];
    const currentIndex = steps.indexOf(currentStep);
    
    if (currentStep === 'google-selection' && canProceedFromStep(currentStep)) {
      await loadHeaderPreview();
    }
    
    if (currentStep === 'header-selection' && canProceedFromStep(currentStep) && headerPreview) {
      // Update headers based on selected row and columns
      const selectedRowHeaders = headerPreview.rows[selectedHeaderRow] || [];
      const filteredHeaders = selectedColumns.map(colIndex => selectedRowHeaders[colIndex] || `Column ${colIndex + 1}`);
      setGoogleHeaders(filteredHeaders);
    }
    
    if (currentStep === 'smartsheet-target' && canProceedFromStep(currentStep)) {
      // Load row statistics for the preview
      await loadRowStatistics();
    }
    
    if (currentIndex < steps.length - 1) {
      const nextStep = steps[currentIndex + 1];
      setCurrentStep(nextStep);
      
      // Auto-start execution when moving to execution step
      if (nextStep === 'execution') {
        setTimeout(executeTransfer, 500);
      }
    }
  };

  const handlePrevious = () => {
    const steps: WizardStep[] = ['google-selection', 'header-selection', 'smartsheet-target', 'preview', 'execution'];
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
    if (!selectedSpreadsheet || !selectedTab) {
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
        
        // Create columns based on selected columns and headers
        const selectedHeaders = selectedColumns.map(colIndex => {
          const originalHeaders = headerPreview?.rows[selectedHeaderRow] || [];
          return originalHeaders[colIndex] || `Column ${colIndex + 1}`;
        });
        
        const columns = selectedHeaders.map((header, index) => {
          const sanitizedTitle = sanitizeColumnTitle(header, index, selectedHeaders);
          return {
            title: sanitizedTitle,
            type: 'TEXT_NUMBER' as const,
            primary: index === 0
          };
        });

        // Ensure we have at least one column
        if (columns.length === 0) {
          columns.push({
            title: 'Column 1',
            type: 'TEXT_NUMBER' as const,
            primary: true
          });
        }


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
        
        
        // Create temporary column mappings based on selected columns (backend will fix with real IDs)
        const tempMappings: ColumnMapping[] = selectedHeaders
          .map((header, index) => {
            const cleanHeader = header?.trim() || `Column ${selectedColumns[index] + 1}`;
            return {
              googleColumn: cleanHeader,
              smartsheetColumnId: index + 1, // Temporary - backend will fix
              dataType: 'text' as const,
              googleColumnIndex: selectedColumns[index] // Add original column index for backend
            };
          });

        setColumnMappings(tempMappings);
        toast.success('Smartsheet created successfully');
      } else {
        if (!selectedExistingSheet) {
          toast.error('No existing sheet selected');
          return;
        }
        targetSheet = selectedExistingSheet;
        
        // Create temporary column mappings for existing sheet based on selected columns (backend will fix with real IDs)
        const selectedHeaders = selectedColumns.map(colIndex => {
          const originalHeaders = headerPreview?.rows[selectedHeaderRow] || [];
          return originalHeaders[colIndex] || `Column ${colIndex + 1}`;
        });
        
        const tempMappings: ColumnMapping[] = selectedHeaders
          .map((header, index) => {
            const cleanHeader = header?.trim() || `Column ${selectedColumns[index] + 1}`;
            return {
              googleColumn: cleanHeader,
              smartsheetColumnId: index + 1, // Temporary - backend will fix
              dataType: 'text' as const,
              googleColumnIndex: selectedColumns[index] // Add original column index for backend
            };
          });

        setColumnMappings(tempMappings);
      }

      setExecutionStep('Creating transfer job...');

      // Get the actual mappings to use (from whichever path was taken above)
      let mappingsToUse: ColumnMapping[];
      if (targetOption === 'new') {
        // For new sheets, create the mappings again to ensure we have them
        const selectedHeaders = selectedColumns.map(colIndex => {
          const originalHeaders = headerPreview?.rows[selectedHeaderRow] || [];
          return originalHeaders[colIndex] || `Column ${colIndex + 1}`;
        });
        
        mappingsToUse = selectedHeaders.map((header, index) => {
          const cleanHeader = header?.trim() || `Column ${selectedColumns[index] + 1}`;
          return {
            googleColumn: cleanHeader,
            smartsheetColumnId: index + 1, // Temporary - backend will fix
            dataType: 'text' as const,
            googleColumnIndex: selectedColumns[index] // Add original column index for backend
          };
        });
      } else {
        // For existing sheets, create the mappings again
        const selectedHeaders = selectedColumns.map(colIndex => {
          const originalHeaders = headerPreview?.rows[selectedHeaderRow] || [];
          return originalHeaders[colIndex] || `Column ${colIndex + 1}`;
        });
        
        mappingsToUse = selectedHeaders.map((header, index) => {
          const cleanHeader = header?.trim() || `Column ${selectedColumns[index] + 1}`;
          return {
            googleColumn: cleanHeader,
            smartsheetColumnId: index + 1, // Temporary - backend will fix
            dataType: 'text' as const,
            googleColumnIndex: selectedColumns[index] // Add original column index for backend
          };
        });
      }

      // Validate selected columns before creating job
      if (selectedColumns.length === 0) {
        throw new Error('No columns selected. Please go back and select at least one column to transfer.');
      }

      // Validate column mappings before creating job
      if (mappingsToUse.length === 0) {
        throw new Error('No valid column mappings found. Please check your Google Sheet headers and ensure at least one column has a valid header.');
      }


      // Create transfer job
      const jobData: {
        googleSpreadsheetId: string;
        googleSheetTabs: string[];
        smartsheetId: number;
        columnMappings: ColumnMapping[];
        dryRun: boolean;
        headerRowIndex: number;
        selectedColumns: number[];
      } = {
        googleSpreadsheetId: selectedSpreadsheet.spreadsheetId,
        googleSheetTabs: [selectedTab],
        smartsheetId: targetSheet.id,
        columnMappings: mappingsToUse,
        dryRun: false,
        headerRowIndex: selectedHeaderRow,
        selectedColumns: selectedColumns
      };
      
      const jobResponse = await transferAPI.createJob(jobData as any);

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

  const renderHeaderSelectionStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Select Header Row</h3>
        <p className="text-sm text-gray-600 mb-4">
          Choose which row contains your column headers. Our algorithm detected the most likely header row, but you can select a different one if needed.
        </p>
        
        {loading ? (
          <div className="text-center py-4">Loading header preview...</div>
        ) : headerPreview ? (
          <div className="space-y-4">
            {/* Header row options */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">
                🔍 Detected Header Row: {headerPreview.detectedHeaderRow + 1}
              </h4>
              <div className="flex flex-wrap gap-1">
                {headerPreview.detectedHeaders.slice(0, 10).map((header, index) => (
                  <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                    {header || `Col ${index + 1}`}
                  </span>
                ))}
                {headerPreview.detectedHeaders.length > 10 && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                    +{headerPreview.detectedHeaders.length - 10} more
                  </span>
                )}
              </div>
            </div>

            {/* Row selection */}
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Select Header Row:</h4>
              <div className="bg-white border rounded-lg overflow-hidden">
                <div className="grid grid-cols-12 gap-1 p-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
                  <div>Row</div>
                  <div className="col-span-11">Preview (first 11 columns)</div>
                </div>
                
                {headerPreview.rows.slice(0, 8).map((row, rowIndex) => (
                  <label
                    key={rowIndex}
                    className={`grid grid-cols-12 gap-1 p-2 border-b cursor-pointer hover:bg-gray-50 ${
                      selectedHeaderRow === rowIndex ? 'bg-blue-50 border-blue-200' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <input
                        type="radio"
                        name="headerRow"
                        value={rowIndex}
                        checked={selectedHeaderRow === rowIndex}
                        onChange={() => setSelectedHeaderRow(rowIndex)}
                        className="mr-2"
                      />
                      <span className="text-sm font-medium">{rowIndex + 1}</span>
                    </div>
                    <div className="col-span-11 grid grid-cols-11 gap-1">
                      {Array.from({ length: 11 }, (_, colIndex) => (
                        <div
                          key={colIndex}
                          className="text-xs p-1 bg-gray-100 rounded truncate"
                          title={row[colIndex] || ''}
                        >
                          {row[colIndex] || '-'}
                        </div>
                      ))}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Column selection */}
            {selectedHeaderRow >= 0 && headerPreview.rows[selectedHeaderRow] && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-3">
                    📋 Select Columns to Transfer from Row {selectedHeaderRow + 1}:
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    <div className="flex items-center mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedColumns.length === headerPreview.rows[selectedHeaderRow].length) {
                            setSelectedColumns([]);
                          } else {
                            const allColumns = Array.from({ length: headerPreview.rows[selectedHeaderRow].length }, (_, i) => i);
                            setSelectedColumns(allColumns);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        {selectedColumns.length === headerPreview.rows[selectedHeaderRow].length ? 'Deselect All' : 'Select All'}
                      </button>
                      <span className="ml-3 text-sm text-blue-700">
                        {selectedColumns.length} of {headerPreview.rows[selectedHeaderRow].length} columns selected
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {headerPreview.rows[selectedHeaderRow].map((header, colIndex) => (
                        <label key={colIndex} className="flex items-center space-x-2 p-2 border rounded hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedColumns.includes(colIndex)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedColumns([...selectedColumns, colIndex].sort((a, b) => a - b));
                              } else {
                                setSelectedColumns(selectedColumns.filter(col => col !== colIndex));
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {header || `Column ${colIndex + 1}`}
                            </div>
                            <div className="text-xs text-gray-500">
                              Column {colIndex + 1}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Selected columns preview */}
                {selectedColumns.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h4 className="font-medium text-green-900 mb-2">
                      ✓ Selected Columns ({selectedColumns.length}):
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedColumns.slice(0, 15).map((colIndex) => (
                        <span key={colIndex} className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                          {headerPreview.rows[selectedHeaderRow][colIndex] || `Col ${colIndex + 1}`}
                        </span>
                      ))}
                      {selectedColumns.length > 15 && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                          +{selectedColumns.length - 15} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            Please go back and select a Google Sheet first.
          </div>
        )}
      </div>
    </div>
  );

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
                onClick={() => {
                  setSelectedSpreadsheet(sheet);
                  setSelectedTab(''); // Reset tab selection when spreadsheet changes
                }}
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
          <h4 className="font-medium text-gray-900 mb-2">Select Tab to Transfer</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {selectedSpreadsheet.sheets.map((tab) => (
              <label key={tab.sheetId} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="selectedTab"
                  value={tab.title}
                  checked={selectedTab === tab.title}
                  onChange={(e) => setSelectedTab(e.target.value)}
                  className="text-primary-600 focus:ring-primary-500 border-gray-300"
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
            {targetOption === 'new' && (
              <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                Creates fresh sheet with selected columns as headers
              </div>
            )}
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
            {targetOption === 'existing' && (
              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                Appends data to bottom of existing sheet (headers skipped)
              </div>
            )}
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
        <div className="space-y-4">
          {/* Workspace Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Workspace
            </label>
            <select
              value={selectedWorkspace?.id || ''}
              onChange={(e) => {
                const workspace = workspaces.find(w => w.id === parseInt(e.target.value));
                setSelectedWorkspace(workspace || null);
                setSelectedFolder(null); // Reset folder when workspace changes
                setSelectedExistingSheet(null); // Reset sheet when workspace changes
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

          {/* Folder Selection */}
          {selectedWorkspace && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Folder
              </label>
              <select
                value={selectedFolder?.id || ''}
                onChange={(e) => {
                  const folder = folders.find(f => f.id === parseInt(e.target.value));
                  setSelectedFolder(folder || null);
                  setSelectedExistingSheet(null); // Reset sheet when folder changes
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sheet Selection */}
          {selectedFolder && (
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
      )}
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
            <span className="font-medium">Tab:</span> {selectedTab}
          </div>
          <div>
            <span className="font-medium">Header Row:</span> Row {selectedHeaderRow + 1}
          </div>
          <div>
            <span className="font-medium">Selected Columns:</span> {selectedColumns.length} columns
          </div>
          <div>
            <span className="font-medium">Target:</span> 
            {targetOption === 'new' 
              ? ` New sheet "${newSheetName}" in ${selectedWorkspace?.name}${selectedFolder ? ` > ${selectedFolder.name}` : ''}`
              : ` Existing sheet "${selectedExistingSheet?.name}"`
            }
          </div>
        </div>

        {/* Row Statistics */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="font-medium text-green-900 mb-2">📊 Data to Transfer:</h4>
          {rowStats ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-green-700 font-medium">Rows with Data:</span> {rowStats.totalRows.toLocaleString()}
                </div>
                <div>
                  <span className="text-green-700 font-medium">Will Transfer:</span> {rowStats.dataRows.toLocaleString()} rows
                </div>
              </div>
              {rowStats.headerRows > 0 && (
                <div className="mt-2 text-xs text-green-600">
                  {rowStats.headerRows.toLocaleString()} header row(s) will be {targetOption === 'new' ? 'used as column headers' : 'skipped'}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-green-700">
              Loading transfer statistics...
            </div>
          )}
        </div>

        {/* Show selected columns preview */}
        {googleHeaders.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 mb-2">Columns to Transfer:</h4>
            <div className="flex flex-wrap gap-1">
              {googleHeaders.slice(0, 15).map((header, index) => (
                <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                  {header}
                </span>
              ))}
              {googleHeaders.length > 15 && (
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                  +{googleHeaders.length - 15} more
                </span>
              )}
            </div>
          </div>
        )}
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
      case 'header-selection':
        return renderHeaderSelectionStep();
      case 'smartsheet-target':
        return renderSmartsheetTargetStep();
      case 'preview':
        return renderPreviewStep();
      case 'execution':
        return renderExecutionStep();
      default:
        return null;
    }
  };

  const getStepNumber = (step: WizardStep): number => {
    const steps: WizardStep[] = ['google-selection', 'header-selection', 'smartsheet-target', 'preview', 'execution'];
    return steps.indexOf(step) + 1;
  };

  const getStepTitle = (step: WizardStep): string => {
    const titles = {
      'google-selection': 'Select Google Sheet',
      'header-selection': 'Choose Headers & Columns',
      'smartsheet-target': 'Choose Target',
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