import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TransferWizard from '../components/TransferWizard';
import TransferProgress from '../components/TransferProgress';

function TransferPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  const handleJobCreated = (jobId: string) => {
    navigate(`/transfer/${jobId}`);
  };

  if (jobId) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate('/transfer')}
            className="inline-flex items-center text-blue-600 hover:text-blue-800"
          >
            <span className="mr-2">←</span>
            Back to New Transfer
          </button>
        </div>
        <TransferProgress jobId={jobId} />
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