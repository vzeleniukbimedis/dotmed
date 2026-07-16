import { FileSpreadsheet, FileText, FileJson } from 'lucide-react';
import { motion } from 'framer-motion';
import { downloadJson, downloadCsv, downloadXlsx } from '../lib/exportUtils.js';

export default function ExportButtons({ items }) {
  const successCount = items.filter((i) => i.status === 'success').length;
  if (successCount === 0) return null;

  return (
    <div className="export-actions">
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={() => downloadXlsx(items)}>
        <FileSpreadsheet size={15} /> Excel
      </motion.button>
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={() => downloadCsv(items)}>
        <FileText size={15} /> CSV
      </motion.button>
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={() => downloadJson(items)}>
        <FileJson size={15} /> JSON
      </motion.button>
    </div>
  );
}
