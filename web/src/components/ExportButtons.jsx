import { useState } from 'react';
import { FileSpreadsheet, FileText, FileJson, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { downloadJson, downloadCsv, downloadXlsx } from '../lib/exportUtils.js';
import { getJob } from '../lib/api.js';

// Only a page of items is kept in memory for large jobs (see App.jsx
// pagination) — exporting must always pull the complete, untruncated set
// straight from the server, not whatever page happens to be on screen.
export default function ExportButtons({ jobId, successCount }) {
  const [exporting, setExporting] = useState(false);
  if (!successCount) return null;

  async function handleExport(downloadFn) {
    setExporting(true);
    try {
      const full = await getJob(jobId);
      downloadFn(full.items, full.mode);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="export-actions">
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" disabled={exporting} onClick={() => handleExport(downloadXlsx)}>
        {exporting ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />} Excel
      </motion.button>
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" disabled={exporting} onClick={() => handleExport(downloadCsv)}>
        {exporting ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} CSV
      </motion.button>
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" disabled={exporting} onClick={() => handleExport(downloadJson)}>
        {exporting ? <Loader2 size={15} className="spin" /> : <FileJson size={15} />} JSON
      </motion.button>
    </div>
  );
}
