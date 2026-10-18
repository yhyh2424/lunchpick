/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * Google Apps Script (GAS) API Proxy & Atomic Storage Layer
 * 
 * Auto-Daily Reset & KST Idempotency:
 * - Checks active KST date (Asia/Seoul)
 * - If current date is different from sheet's recorded date,
 *   automatically resets active counters to 0표!
 * - ScriptLock 10,000ms acquisition window (FR-3.1)
 * - CacheService 10s idempotency key cache with UUIDv4 deduplication (FR-3.2)
 * - Atomic range increment eliminating Read-Modify-Write lost updates
 * - Asia/Seoul (KST) server timestamp generation (FR-3.3)
 * - Defensive null-coalescing for corrupted/empty sheet cells (SRS-FR-003)
 */

var SHEET_NAME = 'LunchVotes';
var ARCHIVE_SHEET_NAME = 'LunchVotes_Archive';
var MENU_KEYS = ['jeyuk', 'jajang', 'tonkatsu', 'gukbap'];
var IDEMPOTENCY_CACHE_TTL_SEC = 10;

/**
 * Handle GET Requests: Retrieve current vote tallies and server KST time
 * Endpoint: ?action=getTallies or ?action=resetTallies
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getTallies';
    var sheet = getOrCreateVotingSheet();

    // Check and perform auto daily reset if KST date changed
    checkAndPerformDailyReset(sheet);

    // Support manual reset trigger
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

/**
 * Handle POST Requests: Atomic Vote Submission with LockService & Idempotency
 * Payload: { action: 'vote', menuId: 'jeyuk', requestId: 'uuid-v4', clientTimestamp: 123456789 }
 *       or { action: 'resetTallies' }
 */
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

    // Handle reset action via POST
    if (action === 'resetTallies') {
      lockAcquired = lock.tryLock(5000);
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

    var menuId = (payload.menuId || '').trim();
    var requestId = (payload.requestId || '').trim();

    if (!menuId || MENU_KEYS.indexOf(menuId) === -1) {
      throw new Error('Invalid or missing menuId: ' + menuId);
    }

    // FR-3.2: Check UUIDv4 idempotency cache within 10-second window
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

    // FR-3.1: Acquire ScriptLock (up to 10,000ms)
    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      return createJsonResponse({
        status: 'error',
        code: 'LOCK_TIMEOUT',
        message: 'Lock acquisition exhausted (>10s). Server busy.'
      });
    }

    var sheet = getOrCreateVotingSheet();

    // Check if day changed while waiting for lock
    checkAndPerformDailyReset(sheet);

    // Double-check idempotency cache inside the lock
    if (requestId && cache.get('vote_uuid_' + requestId)) {
      return createJsonResponse({
        status: 'success',
        idempotent_duplicate: true,
        server_time_kst: getServerTimeKst(),
        active_date: getTodayKstString(),
        tallies: readTalliesSafely(sheet)
      });
    }

    // Execute atomic range increment
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

    // Store requestId in 10-second idempotency cache
    if (requestId) {
      cache.put('vote_uuid_' + requestId, '1', IDEMPOTENCY_CACHE_TTL_SEC);
    }

    var updatedTallies = readTalliesSafely(sheet);
    var serverTimeKst = getServerTimeKst();

    return createJsonResponse({
      status: 'success',
      server_time_kst: serverTimeKst,
      active_date: getTodayKstString(),
      tallies: updatedTallies
    });

  } catch (err) {
    return createJsonResponse({
      status: 'error',
      message: 'Vote processing error: ' + err.toString()
    });
  } finally {
    if (lockAcquired) {
      try {
        lock.releaseLock();
      } catch (e) {}
    }
  }
}

/**
 * Returns current date string in KST: YYYY-MM-DD
 */
function getTodayKstString() {
  return Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
}

/**
 * Returns current Server Time in KST as ISO 8601 string
 */
function getServerTimeKst() {
  return Utilities.formatDate(new Date(), 'GMT+9', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Checks if the current KST date differs from recorded date.
 * If changed, resets all active vote counts to 0!
 */
function checkAndPerformDailyReset(sheet) {
  var todayKst = getTodayKstString();
  var recordedDate = sheet.getRange(1, 3).getValue();
  
  if (recordedDate !== todayKst) {
    var lock = LockService.getScriptLock();
    var acquired = lock.tryLock(5000);
    if (acquired) {
      try {
        recordedDate = sheet.getRange(1, 3).getValue();
        if (recordedDate !== todayKst) {
          // If previous day had recorded votes, archive them
          if (recordedDate && typeof recordedDate === 'string' && recordedDate.indexOf('-') > -1) {
            archivePreviousDayResults(sheet, recordedDate);
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
 * Resets all 4 menu vote counts in column B to 0 and updates active date in C1
 */
function resetAllTalliesToZero(sheet) {
  var todayKst = getTodayKstString();
  for (var i = 0; i < MENU_KEYS.length; i++) {
    sheet.getRange(i + 2, 2).setValue(0);
  }
  sheet.getRange(1, 3).setValue(todayKst);
  SpreadsheetApp.flush();
}

/**
 * Archives previous day's final tallies to LunchVotes_Archive sheet
 */
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
  } catch (e) {
    console.warn('Archiving error:', e);
  }
}

/**
 * Defensive Telemetry & Null-Coalescing: Maps empty/invalid cells to 0
 */
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

/**
 * Ensures the Google Sheet exists and has proper headers, initial rows, and date column
 */
function getOrCreateVotingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['menu_id', 'vote_count', getTodayKstString()]]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    
    var initialRows = [
      ['jeyuk', 0],
      ['jajang', 0],
      ['tonkatsu', 0],
      ['gukbap', 0]
    ];
    sheet.getRange(2, 1, initialRows.length, 2).setValues(initialRows);
    SpreadsheetApp.flush();
  } else {
    // If column C is empty, initialize with today's date
    var recordedDate = sheet.getRange(1, 3).getValue();
    if (!recordedDate) {
      sheet.getRange(1, 3).setValue(getTodayKstString());
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
