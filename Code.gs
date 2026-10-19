/**
 * Lunch Menu Voting Web Service (v4.1.0)
 * Google Apps Script (GAS) API Proxy & Atomic Storage Layer
 * FIX: C1 날짜 셀 Date객체→문자열 변환, cancelVote 기능 추가
 */

var SHEET_NAME = 'LunchVotes';
var ARCHIVE_SHEET_NAME = 'LunchVotes_Archive';
var MENU_KEYS = ['jeyuk', 'jajang', 'tonkatsu', 'gukbap'];
var IDEMPOTENCY_CACHE_TTL_SEC = 10;

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getTallies';
    var sheet = getOrCreateVotingSheet();
    checkAndPerformDailyReset(sheet);

    if (action === 'resetTallies') {
      resetAllTalliesToZero(sheet);
    }

    var tallies = readTalliesSafely(sheet);
    var serverTimeKst = getServerTimeKst();

    return createJsonResponse({
      status: 'success',
      server_time_kst: serverTimeKst,
      active_date: getTodayKstString(),
      tallies: tallies
    });
  } catch (err) {
    return createJsonResponse({
      status: 'error',
      message: 'Failed to retrieve telemetry: ' + err.toString()
    });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = false;

  try {
    var postData = '';
    if (e && e.postData && e.postData.contents) {
      postData = e.postData.contents;
    } else {
      throw new Error('Empty request body');
    }

    var payload = JSON.parse(postData);
    var action = payload.action || 'vote';
    var menuId = (payload.menuId || '').trim();

    // ── resetTallies ──────────────────────────────────────────────────────────
    if (action === 'resetTallies') {
      lockAcquired = lock.tryLock(5000);
      if (!lockAcquired) {
        return createJsonResponse({ status: 'error', message: 'Lock timeout on reset.' });
      }
      var sheet = getOrCreateVotingSheet();
      resetAllTalliesToZero(sheet);
      return createJsonResponse({
        status: 'success',
        message: 'All menu tallies reset to 0.',
        server_time_kst: getServerTimeKst(),
        active_date: getTodayKstString(),
        tallies: readTalliesSafely(sheet)
      });
    }

    // ── cancelVote (내 투표 기록 초기화 시 해당 메뉴 -1) ──────────────────────
    if (action === 'cancelVote') {
      if (!menuId || MENU_KEYS.indexOf(menuId) === -1) {
        throw new Error('Invalid or missing menuId for cancelVote: ' + menuId);
      }
      lockAcquired = lock.tryLock(10000);
      if (!lockAcquired) {
        return createJsonResponse({ status: 'error', code: 'LOCK_TIMEOUT', message: 'Lock timeout.' });
      }
      var sheet = getOrCreateVotingSheet();
      checkAndPerformDailyReset(sheet);

      var rowIndex = MENU_KEYS.indexOf(menuId) + 2;
      var cell = sheet.getRange(rowIndex, 2);
      var currentVal = cell.getValue();
      var safeCurrent = 0;
      if (typeof currentVal === 'number' && !isNaN(currentVal)) {
        safeCurrent = Math.max(0, Math.floor(currentVal));
      }
      cell.setValue(Math.max(0, safeCurrent - 1));
      SpreadsheetApp.flush();

      return createJsonResponse({
        status: 'success',
        server_time_kst: getServerTimeKst(),
        active_date: getTodayKstString(),
        tallies: readTalliesSafely(sheet)
      });
    }

    // ── vote ──────────────────────────────────────────────────────────────────
    var requestId = (payload.requestId || '').trim();

    if (!menuId || MENU_KEYS.indexOf(menuId) === -1) {
      throw new Error('Invalid or missing menuId: ' + menuId);
    }

    var cache = CacheService.getScriptCache();
    if (requestId) {
      var cachedHit = cache.get('vote_uuid_' + requestId);
      if (cachedHit) {
        var sheet = getOrCreateVotingSheet();
        return createJsonResponse({
          status: 'success',
          idempotent_duplicate: true,
          server_time_kst: getServerTimeKst(),
          active_date: getTodayKstString(),
          tallies: readTalliesSafely(sheet)
        });
      }
    }

    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      return createJsonResponse({
        status: 'error',
        code: 'LOCK_TIMEOUT',
        message: 'Lock acquisition exhausted (>10s). Server busy.'
      });
    }

    var sheet = getOrCreateVotingSheet();
    checkAndPerformDailyReset(sheet);

    if (requestId && cache.get('vote_uuid_' + requestId)) {
      return createJsonResponse({
        status: 'success',
        idempotent_duplicate: true,
        server_time_kst: getServerTimeKst(),
        active_date: getTodayKstString(),
        tallies: readTalliesSafely(sheet)
      });
    }

    var rowIndex = MENU_KEYS.indexOf(menuId) + 2;
    var cell = sheet.getRange(rowIndex, 2);
    var currentVal = cell.getValue();
    var safeCurrent = 0;
    if (typeof currentVal === 'number' && !isNaN(currentVal)) {
      safeCurrent = Math.max(0, Math.floor(currentVal));
    } else if (typeof currentVal === 'string' && currentVal.trim() !== '') {
      var parsed = parseInt(currentVal.trim(), 10);
      safeCurrent = isNaN(parsed) ? 0 : Math.max(0, parsed);
    }

    cell.setValue(safeCurrent + 1);
    SpreadsheetApp.flush();

    if (requestId) {
      cache.put('vote_uuid_' + requestId, '1', IDEMPOTENCY_CACHE_TTL_SEC);
    }

    return createJsonResponse({
      status: 'success',
      server_time_kst: getServerTimeKst(),
      active_date: getTodayKstString(),
      tallies: readTalliesSafely(sheet)
    });

  } catch (err) {
    return createJsonResponse({
      status: 'error',
      message: 'Vote processing error: ' + err.toString()
    });
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (ex) {}
    }
  }
}

function getTodayKstString() {
  return Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
}

function getServerTimeKst() {
  return Utilities.formatDate(new Date(), 'GMT+9', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * [FIX v4.1.0] Date 객체 → 문자열 변환으로 비교
 * Google Sheets가 날짜 형식 문자열을 자동으로 Date 객체로 저장하는 버그 방지
 */
function normalizeDateCell(rawValue) {
  if (!rawValue) return '';
  if (rawValue instanceof Date) {
    return Utilities.formatDate(rawValue, 'GMT+9', 'yyyy-MM-dd');
  }
  return String(rawValue).trim();
}

function checkAndPerformDailyReset(sheet) {
  var todayKst = getTodayKstString();
  var recordedDate = normalizeDateCell(sheet.getRange(1, 3).getValue());

  if (recordedDate !== todayKst) {
    var lock = LockService.getScriptLock();
    var acquired = lock.tryLock(5000);
    if (acquired) {
      try {
        var recheckDate = normalizeDateCell(sheet.getRange(1, 3).getValue());
        if (recheckDate !== todayKst) {
          if (recheckDate && recheckDate.indexOf('-') > -1) {
            archivePreviousDayResults(sheet, recheckDate);
          }
          resetAllTalliesToZero(sheet);
        }
      } finally {
        lock.releaseLock();
      }
    }
  }
}

/**
 * [FIX v4.1.0] setNumberFormat('@') 으로 텍스트 형식 강제 → Sheets 날짜 자동변환 방지
 */
function resetAllTalliesToZero(sheet) {
  var todayKst = getTodayKstString();
  for (var i = 0; i < MENU_KEYS.length; i++) {
    sheet.getRange(i + 2, 2).setValue(0);
  }
  var dateCell = sheet.getRange(1, 3);
  dateCell.setNumberFormat('@');
  dateCell.setValue(todayKst);
  SpreadsheetApp.flush();
}

function archivePreviousDayResults(sheet, dateStr) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var archiveSheet = ss.getSheetByName(ARCHIVE_SHEET_NAME);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(ARCHIVE_SHEET_NAME);
      archiveSheet.getRange(1, 1, 1, 3).setValues([['date', 'menu_id', 'final_votes']]);
      archiveSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    var currentData = sheet.getRange(2, 1, MENU_KEYS.length, 2).getValues();
    var archiveRows = [];
    for (var i = 0; i < currentData.length; i++) {
      archiveRows.push([dateStr, currentData[i][0], currentData[i][1]]);
    }
    if (archiveRows.length > 0) {
      archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, archiveRows.length, 3).setValues(archiveRows);
    }
  } catch (ex) {
    console.warn('Archiving error:', ex);
  }
}

function readTalliesSafely(sheet) {
  var data = sheet.getRange(2, 1, MENU_KEYS.length, 2).getValues();
  var tallies = {};
  for (var i = 0; i < MENU_KEYS.length; i++) {
    var key = MENU_KEYS[i];
    var cellValue = (data[i] && data[i].length > 1) ? data[i][1] : 0;
    var safeInt = 0;
    if (typeof cellValue === 'number' && !isNaN(cellValue)) {
      safeInt = Math.max(0, Math.floor(cellValue));
    } else if (typeof cellValue === 'string' && cellValue.trim() !== '') {
      var parsed = parseInt(cellValue.trim(), 10);
      safeInt = isNaN(parsed) ? 0 : Math.max(0, parsed);
    }
    tallies[key] = safeInt;
  }
  return tallies;
}

function getOrCreateVotingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['menu_id', 'vote_count']]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    var dateCell = sheet.getRange(1, 3);
    dateCell.setNumberFormat('@');
    dateCell.setValue(getTodayKstString());
    dateCell.setFontWeight('bold');
    sheet.getRange(2, 1, 4, 2).setValues([
      ['jeyuk', 0], ['jajang', 0], ['tonkatsu', 0], ['gukbap', 0]
    ]);
    SpreadsheetApp.flush();
  } else {
    var rawDate = sheet.getRange(1, 3).getValue();
    if (!rawDate || rawDate instanceof Date) {
      var dateCell = sheet.getRange(1, 3);
      dateCell.setNumberFormat('@');
      dateCell.setValue(rawDate instanceof Date
        ? Utilities.formatDate(rawDate, 'GMT+9', 'yyyy-MM-dd')
        : getTodayKstString());
      SpreadsheetApp.flush();
    }
  }
  return sheet;
}

function createJsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}