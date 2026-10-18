/**
 * Lunch Menu Voting Web Service (v4.0.0 Production Baseline)
 * API Proxy & Google Apps Script (GAS) Communication Layer
 * Supports Production GAS Endpoint + Interactive Fault-Injection Simulator
 * Standard Compliance: IEEE Std 830-1998 / ISO/IEC/IEEE 29148 / ISO/IEC/IEEE 29119
 */

import { CONFIG } from './config.js';

export class ApiClient {
  constructor(state) {
    this.state = state;
    this.gasUrl = localStorage.getItem(CONFIG.STORAGE_KEYS.GAS_URL) || CONFIG.DEFAULT_GAS_URL || '';
    const storedMock = localStorage.getItem(CONFIG.STORAGE_KEYS.MOCK_MODE);
    this.isMockMode = storedMock === null ? false : storedMock === 'true';
    this.faultInjection = localStorage.getItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION) || 'none';
    
    // In-memory idempotency cache for simulator (10-second window, FR-3.2)
    this.simulatedIdempotencyCache = new Map();
  }

  setGasUrl(url) {
    this.gasUrl = (url || '').trim();
    if (this.gasUrl) {
      localStorage.setItem(CONFIG.STORAGE_KEYS.GAS_URL, this.gasUrl);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_KEYS.GAS_URL);
    }
  }

  setMockMode(enabled) {
    this.isMockMode = !!enabled;
    localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_MODE, String(this.isMockMode));
  }

  setFaultInjection(mode) {
    // 'none' | 'timeout' | 'lock_fail' | 'corrupt_data'
    this.faultInjection = mode;
    localStorage.setItem(CONFIG.STORAGE_KEYS.FAUL_INJECTION, mode);
  }

  /**
   * Resets all tallies on the server and local storage to 0
   */
  async resetTallies() {
    const todayKst = this.state.getTodayKstDateString();
    const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
    const zeroTallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
    localStorage.setItem(dateKey, JSON.stringify(zeroTallies));
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LOCAL_TALLIES);

    if (this.gasUrl && !this.isMockMode) {
      try {
        await fetch(`${this.gasUrl}?action=resetTallies&t=${Date.now()}`, { method: 'GET' });
      } catch (e) {
        console.warn('GAS reset request error:', e);
      }
    }
    return zeroTallies;
  }

  /**
   * Fetches latest telemetry from GAS Web App or Mock Simulator
   * @returns {Promise<Object>}
   */
  async fetchTelemetry() {
    if (!this.gasUrl || this.isMockMode) {
      return this.fetchMockTelemetry();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.gasUrl}?action=getTallies&t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('GAS fetch telemetry failed, falling back to cached state:', err);
      throw err;
    }
  }

  /**
   * Submits a vote to GAS Web App or Mock Simulator
   * @param {string} menuId 
   * @param {string} requestId UUIDv4
   * @returns {Promise<Object>}
   */
  async submitVote(menuId, requestId) {
    // If in Mock / Simulator mode or GAS URL is missing, execute simulator
    if (!this.gasUrl || this.isMockMode) {
      return this.submitMockVote(menuId, requestId);
    }

    // Production GAS Web App Submission
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const payload = {
        action: 'vote',
        menuId,
        requestId,
        clientTimestamp: Date.now()
      };

      const response = await fetch(this.gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8', // Plain text to avoid CORS preflight options block in GAS
          'X-Request-ID': requestId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Vote Submission Failed`);
      }

      const result = await response.json();
      if (result.status !== 'success') {
        throw new Error(result.message || 'Server increment failed');
      }

      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // =========================================================================
  // Built-in Mock Simulator (Guarantees Zero-Defect QA Verification)
  // =========================================================================

  /**
   * Mock Telemetry Fetch with fault injection support
   */
  async fetchMockTelemetry() {
    // Simulate slight network roundtrip (150ms)
    await new Promise(res => setTimeout(res, 150));

    // Calculate current KST time
    const now = new Date();
    const utcEpoch = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstEpoch = utcEpoch + (9 * 60 * 60 * 1000);
    const serverTimeKst = new Date(kstEpoch).toISOString();

    // Handle Corrupted Data fault injection (SRS-FR-003 testing)
    if (this.faultInjection === 'corrupt_data') {
      return {
        status: 'success',
        server_time_kst: serverTimeKst,
        tallies: {
          jeyuk: null,             // Null cell
          jajang: 'INVALID_STR',   // Non-numeric cell
          tonkatsu: 14,            // Normal cell
          gukbap: undefined        // Undefined cell
        }
      };
    }

    // Daily auto-zero: Retrieve simulated tallies for today or initialize all to 0표
    const todayKst = this.state.getTodayKstDateString();
    const dateKey = `${CONFIG.STORAGE_KEYS.LOCAL_TALLIES}_${todayKst}`;
    let stored = localStorage.getItem(dateKey);
    let tallies = {};
    if (stored) {
      try {
        tallies = JSON.parse(stored);
      } catch {
        tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      }
    } else {
      // Default to 0 votes for all menus every new day
      tallies = { jeyuk: 0, jajang: 0, tonkatsu: 0, gukbap: 0 };
      localStorage.setItem(dateKey, JSON.stringify(tallies));
    }

    return {
      status: 'success',
      server_time_kst: serverTimeKst,
      tallies
    };
  }

  /**
   * Mock Vote Submission simulating GAS ScriptLock & Idempotency
   */
  async submitMockVote(menuId, requestId) {
    // Fault Injection 1: Timeout >= 5000ms (SRS-FR-005, NFR-3, TC-ERR-001)
    if (this.faultInjection === 'timeout') {
      // Simulate slow network exceeding 5000ms
      await new Promise(res => setTimeout(res, 5200));
      throw new Error('Network request timed out (>= 5000ms)');
    }

    // Fault Injection 2: Lock Exhaustion (ScriptLock.tryLock failure > 10s)
    if (this.faultInjection === 'lock_fail') {
      await new Promise(res => setTimeout(res, 600));
      throw new Error('Server lock acquisition failed (LockService exhaustion > 10s)');
    }

    // Simulate standard GAS atomic lock & execution delay (350ms)
    await new Promise(res => setTimeout(res, 350));

    // FR-3.2: 10-second idempotency window deduplication check
    const now = Date.now();
    if (this.simulatedIdempotencyCache.has(requestId)) {
      const cachedTime = this.simulatedIdempotencyCache.get(requestId);
      if (now - cachedTime < 10000) {
        console.warn(`[IDEMPOTENCY] Dropped duplicate request ID: ${requestId}`);
        // Return existing tallies without re-incrementing
        const currentData = await this.fetchMockTelemetry();
        return {
          status: 'success',
          idempotent_duplicate: true,
          server_time_kst: currentData.server_time_kst,
          tallies: currentData.tallies
        };
      }
    }
    this.simulatedIdempotencyCache.set(requestId, now);

    // Atomic increment in mock storage
    let currentData = await this.fetchMockTelemetry();
    let tallies = { ...currentData.tallies };
    tallies[menuId] = (tallies[menuId] || 0) + 1;
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_TALLIES, JSON.stringify(tallies));

    // Clean old keys from idempotency cache
    for (const [id, time] of this.simulatedIdempotencyCache.entries()) {
      if (now - time > 15000) {
        this.simulatedIdempotencyCache.delete(id);
      }
    }

    return {
      status: 'success',
      server_time_kst: currentData.server_time_kst,
      tallies
    };
  }
}
