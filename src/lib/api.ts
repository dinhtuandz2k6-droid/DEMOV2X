/**
 * API service to interact with the backend server
 */

export interface SimulationReport {
  id: number | string;
  name: string;
  timestamp: string;
  data: {
    accel: string;
    heading: string;
    lat: string | number;
    lng: string | number;
    v2x: string;
    hash: string;
  };
  status: string;
  createdAt: string;
  source: 'server' | 'firebase';
}

export const serverApi = {
  /**
   * Fetch all reports from the server-side JSON database
   */
  getReports: async (): Promise<SimulationReport[]> => {
    try {
      const response = await fetch('/api/reports');
      if (!response.ok) throw new Error('Failed to fetch from server');
      return await response.json();
    } catch (error) {
      console.error('Server API error:', error);
      return [];
    }
  },

  /**
   * Save a report to the server-side JSON database
   */
  saveReport: async (report: Omit<SimulationReport, 'source'>): Promise<boolean> => {
    try {
      const adminCode = sessionStorage.getItem('admin_access_code') || '';
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-code': adminCode
        },
        body: JSON.stringify({ ...report, source: 'server' }),
      });
      return response.ok;
    } catch (error) {
      console.error('Server API error:', error);
      return false;
    }
  },

  /**
   * Fetch all blocks from the server-side JSON database
   */
  getBlocks: async (): Promise<any[]> => {
    try {
      const response = await fetch('/api/blocks');
      if (!response.ok) throw new Error('Failed to fetch blocks from server');
      return await response.json();
    } catch (error) {
      console.error('Server API blocks error:', error);
      return [];
    }
  },

  /**
   * Save a block to the server-side JSON database
   */
  saveBlock: async (block: any): Promise<boolean> => {
    try {
      const adminCode = sessionStorage.getItem('admin_access_code') || '';
      const response = await fetch('/api/blocks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-code': adminCode
        },
        body: JSON.stringify(block),
      });
      return response.ok;
    } catch (error) {
      console.error('Server API save block error:', error);
      return false;
    }
  }
};
