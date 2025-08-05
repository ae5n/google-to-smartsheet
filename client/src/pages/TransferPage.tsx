import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TransferWizard from '../components/TransferWizard';

function TransferPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  const handleJobCreated = (jobId: string) => {
    navigate(`/transfer/${jobId}`);
  };

  if (jobId) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Transfer Job: {jobId}</h1>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <p className="text-gray-600">Transfer job details and progress tracking will be implemented here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">New Transfer</h1>
      <TransferWizard onJobCreated={handleJobCreated} />
    </div>
  );
}

export default TransferPage;