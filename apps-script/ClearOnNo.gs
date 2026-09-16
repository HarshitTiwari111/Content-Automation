/**
 * CONTENT_QUEUE: "Search Ads (Y/N)" me No karte hi us row ke ye columns khaali:
 *   Search Campaign ID, Status, Error / Notes,
 *   Display (Y/N), Display Campaign ID, Featured Image
 *
 * LAGANA KAISE HAI (Sheet → Extensions → Apps Script):
 *   1. Left side "+" → Script → naam "ClearOnNo" → ye poora code paste karo → Save.
 *   2. Kisi file me pehle se `function onEdit(e)` hai?
 *        HAAN → us function ke andar ek line jodo:   clearRowOnSearchNo(e);
 *        NAHI → neeche wale onEdit ke aage se // hata do.
 *      (Do onEdit ho gaye to purana wala kaam karna band kar dega.)
 */

// function onEdit(e) {
//   clearRowOnSearchNo(e);
// }

var CQ_TAB = 'CONTENT_QUEUE';
var SEARCH_COLUMN = 'Search Ads (Y/N)';

/** No hote hi ye columns khaali ho jayenge. */
var CLEAR_COLUMNS = [
  'Search Campaign ID',
  'Status',
  'Error / Notes',
  'Display (Y/N)',
  'Display Campaign ID',
  'Featured Image',
];

function clearRowOnSearchNo(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (sheet.getName() !== CQ_TAB) return;

  // Header row ka edit chhod do.
  var row = e.range.getRow();
  if (row < 2) return;

  // Sirf ek cell wala edit (dropdown se No chunna) hi dekhna hai.
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var searchCol = headerColumn_(headers, SEARCH_COLUMN);
  if (searchCol === -1 || e.range.getColumn() !== searchCol) return;

  var value = String(e.range.getValue()).trim().toLowerCase();
  if (value !== 'no' && value !== 'n') return;

  for (var i = 0; i < CLEAR_COLUMNS.length; i++) {
    var col = headerColumn_(headers, CLEAR_COLUMNS[i]);
    if (col !== -1) sheet.getRange(row, col).clearContent();
  }
}

/** Header ka naam -> column number (1-based). Na mile to -1. */
function headerColumn_(headers, name) {
  var wanted = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase().replace(/\s+/g, ' ') === wanted) return i + 1;
  }
  return -1;
}
