/**
 * 🛑 Kill Switch menu — PDF section 16: "admin-only kill switch for all automated paid traffic".
 *
 * Sheet ke upar "🛑 Kill Switch" menu banata hai. ON dabane par SETTINGS tab me
 * "Kill Switch = ON" likha jaata hai. Automation har run pe ye padhta hai:
 *   ON  → nayi campaign nahi banti, chaalu campaigns PAUSE ho jaati hain
 *   OFF → automation normal chalta hai
 *
 * LAGANA KAISE HAI (Sheet → Extensions → Apps Script):
 *   1. Left side "+" → Script → naam "KillSwitch" → ye poora code paste karo → Save.
 *   2. Kisi file me pehle se `function onOpen()` hai?
 *        HAAN → us function ke andar ek line jodo:   addKillSwitchMenu();
 *        NAHI → neeche wala onOpen ke aage se // hata do.
 *      (Do onOpen ho gaye to purane menu gayab ho jayenge — dhyan rakhna.)
 *   3. Sheet reload karo → menu "🛑 Kill Switch" aa jayega.
 */

// function onOpen() {
//   addKillSwitchMenu();
// }

var KILL_SWITCH_TAB = 'SETTINGS';
var KILL_SWITCH_LABEL = 'Kill Switch';

function addKillSwitchMenu() {
  SpreadsheetApp.getUi()
    .createMenu('🛑 Kill Switch')
    .addItem('ON karo (saari paid campaigns roko)', 'killSwitchOn')
    .addItem('OFF karo (automation chalu)', 'killSwitchOff')
    .addSeparator()
    .addItem('Abhi kya hai?', 'killSwitchStatus')
    .addToUi();
}

function killSwitchOn() {
  setKillSwitch_('ON');
}

function killSwitchOff() {
  setKillSwitch_('OFF');
}

function killSwitchStatus() {
  var cell = killSwitchCell_();
  var changed = cell.offset(0, 1).getValue();
  SpreadsheetApp.getUi().alert(
    'Kill Switch abhi: ' + (cell.getValue() || 'OFF') + (changed ? '\nAakhri badlav: ' + changed : '')
  );
}

function setKillSwitch_(value) {
  var ui = SpreadsheetApp.getUi();
  var question =
    value === 'ON'
      ? 'Kill Switch ON karna hai?\n\nNayi campaign nahi banegi, aur chaalu campaigns agli run pe PAUSE ho jayengi.'
      : 'Kill Switch OFF karna hai?\n\nAutomation phir se campaigns banana shuru karega (hamesha PAUSED).';
  if (ui.alert(question, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var cell;
  try {
    cell = killSwitchCell_();
    cell.setValue(value);
    SpreadsheetApp.flush();
  } catch (e) {
    // Asli wajah dikhao — protected ho to Google khud "protected" likhta hai.
    var reason = String((e && e.message) || e);
    var hint = /protect/i.test(reason)
      ? '\n\nSETTINGS tab lock hai aur aapko permission nahi hai — admin se baat karo.'
      : '';
    ui.alert('Kill Switch badal nahi paya.\n\nWajah: ' + reason + hint);
    return;
  }

  // Kisne/kab — ye fail ho to bhi Kill Switch badal chuka hai.
  try {
    var who = '';
    try {
      who = Session.getActiveUser().getEmail();
    } catch (ignore) {}
    var when = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    cell.offset(0, 1).setValue(when + ' — ' + (who || 'unknown'));
  } catch (ignore) {}

  ui.alert('Kill Switch ab ' + value + ' hai.');
}

/** SETTINGS tab me "Kill Switch" wali Value cell. Tab na ho to bana deta hai. */
function killSwitchCell_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(KILL_SWITCH_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(KILL_SWITCH_TAB);
    sheet.getRange('A1:C1').setValues([['Setting', 'Value', 'Last Changed']]).setFontWeight('bold');
    sheet.getRange('A2:B2').setValues([[KILL_SWITCH_LABEL, 'OFF']]);
  }

  var labels = sheet.getRange('A1:A50').getValues();
  for (var i = 0; i < labels.length; i++) {
    if (String(labels[i][0]).trim().toLowerCase() === KILL_SWITCH_LABEL.toLowerCase()) {
      return sheet.getRange(i + 1, 2);
    }
  }

  sheet.appendRow([KILL_SWITCH_LABEL, 'OFF']);
  return sheet.getRange(sheet.getLastRow(), 2);
}
