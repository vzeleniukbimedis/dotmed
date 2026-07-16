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

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toCsv(successItems) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [CSV_COLUMNS.join(',')];
  successItems.forEach(({ url, data }) => {
    rows.push(CSV_COLUMNS.map((c) => {
      if (c === 'url') return escape(url);
      if (c === 'photos') return escape((data.photos || []).join(' | '));
      return escape(data[c]);
    }).join(','));
  });
  // UTF-8 BOM so Excel detects encoding correctly instead of mangling non-ASCII text
  return `﻿${rows.join('\n')}`;
}

export function downloadJson(items) {
  const successItems = items.filter((i) => i.status === 'success');
  download('dotmed-listings.json', JSON.stringify(successItems.map((i) => ({ url: i.url, ...i.data })), null, 2), 'application/json');
}

export function downloadCsv(items) {
  const successItems = items.filter((i) => i.status === 'success');
  download('dotmed-listings.csv', toCsv(successItems), 'text/csv;charset=utf-8');
}

export function downloadXlsx(items) {
  const successItems = items.filter((i) => i.status === 'success');
  const rows = successItems.map(({ url, data }) => {
    const row = {};
    XLSX_COLUMNS.forEach(([key, label]) => {
      if (key === 'url') row[label] = url;
      else if (key === 'photos') row[label] = (data.photos || []).join(' | ');
      else if (key === 'isPart') row[label] = data.isPart ? 'Так' : 'Ні';
      else row[label] = data[key] ?? '';
    });
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows, { header: XLSX_COLUMNS.map(([, label]) => label) });
  sheet['!cols'] = XLSX_COLUMNS.map(([key]) => ({ wch: key === 'description' ? 60 : key === 'photos' ? 40 : 18 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Оголошення');

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  download('dotmed-listings.xlsx', buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
