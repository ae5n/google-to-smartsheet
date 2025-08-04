import React from 'react';
import { useParams } from 'react-router-dom';

function TransferPage() {
  const { jobId } = useParams();

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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <p className="text-gray-600">Transfer creation wizard will be implemented here.</p>
      </div>
    </div>
  );
}

export default TransferPage;