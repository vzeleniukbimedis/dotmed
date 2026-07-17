import * as XLSX from 'xlsx';

const CSV_COLUMNS = ['url', 'title', 'brand', 'model', 'category', 'condition', 'price', 'year', 'warranty', 'isPart', 'partNumber', 'partsDescription', 'description', 'photos'];

const XLSX_COLUMNS = [
  ['url', 'Лінк'],
  ['title', 'Назва'],
  ['brand', 'Бренд'],
  ['model', 'Модель'],
  ['category', 'Тип'],
  ['condition', 'Стан'],
  ['price', 'Ціна'],
  ['year', 'Рік'],
  ['warranty', 'Гарантія'],
  ['isPart', 'Запчастина'],
  ['partNumber', 'Парт-номер'],
  ['partsDescription', 'Опис запчастини'],
  ['description', 'Опис'],
  ['photos', 'Фото'],
];

// Simplified-mode items only ever have url+price populated (see
// server.js's expandStorefront) — exporting the full column set would just
// be a wall of empty cells, so this mode gets its own minimal shape.
const SIMPLIFIED_CSV_COLUMNS = ['url', 'price'];
const SIMPLIFIED_XLSX_COLUMNS = [
  ['url', 'Лінк'],
  ['price', 'Ціна'],
];

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toCsv(successItems, columns) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [columns.join(',')];
  successItems.forEach(({ url, data }) => {
    rows.push(columns.map((c) => {
      if (c === 'url') return escape(url);
      if (c === 'photos') return escape((data.photos || []).join(' | '));
      return escape(data[c]);
    }).join(','));
  });
  // UTF-8 BOM so Excel detects encoding correctly instead of mangling non-ASCII text
  return `﻿${rows.join('\n')}`;
}

export function downloadJson(items, mode) {
  const successItems = items.filter((i) => i.status === 'success');
  const rows = mode === 'simplified'
    ? successItems.map((i) => ({ url: i.url, price: i.data.price }))
    : successItems.map((i) => ({ url: i.url, ...i.data }));
  download('dotmed-listings.json', JSON.stringify(rows, null, 2), 'application/json');
}

export function downloadCsv(items, mode) {
  const successItems = items.filter((i) => i.status === 'success');
  const columns = mode === 'simplified' ? SIMPLIFIED_CSV_COLUMNS : CSV_COLUMNS;
  download('dotmed-listings.csv', toCsv(successItems, columns), 'text/csv;charset=utf-8');
}

export function downloadXlsx(items, mode) {
  const successItems = items.filter((i) => i.status === 'success');
  const columns = mode === 'simplified' ? SIMPLIFIED_XLSX_COLUMNS : XLSX_COLUMNS;
  const rows = successItems.map(({ url, data }) => {
    const row = {};
    columns.forEach(([key, label]) => {
      if (key === 'url') row[label] = url;
      else if (key === 'photos') row[label] = (data.photos || []).join(' | ');
      else if (key === 'isPart') row[label] = data.isPart ? 'Так' : 'Ні';
      else row[label] = data[key] ?? '';
    });
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns.map(([, label]) => label) });
  sheet['!cols'] = columns.map(([key]) => ({ wch: key === 'description' ? 60 : key === 'photos' ? 40 : 18 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Оголошення');

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  download('dotmed-listings.xlsx', buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
