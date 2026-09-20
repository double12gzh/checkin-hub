#!/usr/bin/env node
/**
 * probe-panels.mjs
 *
 * 站点状态与公开 API 嗅探探测引擎
 * 针对国内主流 AI 中转站、福利站及自研网关提供 4 种面板类型的免登录嗅探与探活：
 *   1. newapi:   GET /api/status + GET /api/pricing (占 80%+)
 *   2. vibecode: GET /frontend-api/getConfig + GET /frontend-api/getLoginConfig (RawChat 系)
 *   3. matrix:   GET /api/health (矩阵网关)
 *   4. relay:    GET /v1/models (401 路由探活) + 首页探测 (CheapCodex, NOFX 等自研网关/积分站)
 */

import { URL } from 'node:url';

const UA = 'ai-welfare-probe/1.0 (+https://github.com/)';
const TIMEOUT_MS = 10_000;
const RETRIES = 1;
const RATIO_USD_PER_MTOK = 2.0; // New API 计价约定: 倍率 1 == $0.002 / 1K tokens == $2 / 1M tokens

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isHttpsUrl(urlStr) {
  try {
    const u = new URL(String(urlStr));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}`;
  } catch {
    return urlStr;
  }
}

async function fetchOnce(url, headers = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: res.ok, status: res.status, ms, text, json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithRetry(url, headers = {}, retries = RETRIES) {
  let last = { ok: false, status: 0, error: 'unreachable' };
  for (let i = 0; i <= retries; i += 1) {
    if (i > 0) await sleep(1000 * i);
    last = await fetchOnce(url, headers);
    // 如果拿到 HTTP 响应状态（哪怕是 401/403/404），说明网络可达，不需要退避重试
    if (last.status > 0) return { ...last, attempts: i + 1 };
  }
  return { ...last, attempts: retries + 1 };
}

/**
 * 探测 New API / One API 体系站点
 */
export async function probeNewApi(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const statusRes = await fetchWithRetry(`${base}/api/status`);
  const pricingRes = await fetchWithRetry(`${base}/api/pricing`);

  const result = {
    panel: 'newapi',
    baseUrl: base,
    online: statusRes.status === 200,
    latencyMs: statusRes.ms,
    statusApiOk: statusRes.status === 200,
    systemName: null,
    registerEnabled: null,
    checkinEnabled: null,
    quotaBonusUsd: null,
    authMethods: [],
    pricingApiStatus: pricingRes.status,
    modelsCount: 0,
    sampleModels: [],
    notices: [],
    error: statusRes.error || (statusRes.status !== 200 ? `HTTP ${statusRes.status}` : null),
  };

  if (statusRes.json) {
    const data = statusRes.json.data || statusRes.json;
    result.systemName = data.system_name || data.title || null;
    result.registerEnabled =
      typeof data.register_enabled === 'boolean' ? data.register_enabled : null;
    result.checkinEnabled = typeof data.checkin_enabled === 'boolean' ? data.checkin_enabled : null;

    // 额度折算
    const quotaUnit = Number(data.quota_per_unit) || 500_000;
    const inviteQuota = Number(data.quota_for_invitee ?? data.quota_for_new_user ?? 0);
    if (inviteQuota > 0) {
      result.quotaBonusUsd = Math.round((inviteQuota / quotaUnit) * 100) / 100;
    }

    // 登录方式探测
    const auths = [];
    if (data.github_oauth) auths.push('GitHub');
    if (data.linuxdo_oauth) auths.push('LinuxDO');
    if (data.password_register_enabled) auths.push('Password');
    if (data.wechat_login) auths.push('WeChat');
    if (data.telegram_oauth) auths.push('Telegram');
    if (data.oidc) auths.push('OIDC');
    result.authMethods = auths;

    // 公告信息
    if (data.notice) {
      result.notices.push(String(data.notice).slice(0, 200));
    }
  }

  if (pricingRes.status === 200 && pricingRes.json) {
    const pData = pricingRes.json.data || pricingRes.json;
    if (Array.isArray(pData)) {
      result.modelsCount = pData.length;
      result.sampleModels = pData.slice(0, 5).map((m) => {
        const modelName = m.model_name || m.name || 'unknown';
        const ratio = Number(m.quota_type === 0 ? m.model_ratio : m.ratio) || 1.0;
        const compRatio = Number(m.completion_ratio) || 1.0;
        const inputUsdPerM = Math.round(ratio * RATIO_USD_PER_MTOK * 100) / 100;
        const outputUsdPerM = Math.round(ratio * compRatio * RATIO_USD_PER_MTOK * 100) / 100;
        return {
          model: modelName,
          ratio,
          inputPerM: `$${inputUsdPerM}`,
          outputPerM: `$${outputUsdPerM}`,
        };
      });
    }
  } else if (pricingRes.status === 401) {
    result.pricingNote = '定价接口需登录后查看 (requireAuth)';
  }

  return result;
}

/**
 * 探测 VibeCode 系站点 (RawChat 等)
 */
export async function probeVibeCode(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const cfgRes = await fetchWithRetry(`${base}/frontend-api/getConfig`);
  const loginRes = await fetchWithRetry(`${base}/frontend-api/getLoginConfig`);

  const online = cfgRes.status === 200 || loginRes.status === 200;
  const result = {
    panel: 'vibecode',
    baseUrl: base,
    online,
    latencyMs: cfgRes.ms,
    systemName: null,
    registerEnabled: null,
    checkinEnabled: false, // VibeCode 系多为每日 0 点自动重置或后台领取，无 New API 式每日点击签到
    authMethods: [],
    enabledServices: [],
    error: !online ? cfgRes.error || `HTTP ${cfgRes.status}` : null,
  };

  if (cfgRes.json?.data || cfgRes.json) {
    const d = cfgRes.json.data || cfgRes.json;
    result.systemName = d.system_name || d.title || 'RawChat / VibeCode';
    const sMap = {
      isAuthCodex: 'Codex',
      isAuthClaude: 'Claude Code',
      isAuthClaude2api: 'Claude API',
      isAuthGemini: 'Gemini',
      isAuthGrok: 'Grok',
    };
    for (const [k, v] of Object.entries(sMap)) {
      if (d[k]) result.enabledServices.push(v);
    }
  }

  if (loginRes.json?.data || loginRes.json) {
    const ld = loginRes.json.data || loginRes.json;
    result.registerEnabled = Boolean(
      ld.isEnableMailRegister || ld.isEnableGitHubLogin || ld.isEnableLinuxDoLogin
    );
    if (ld.isEnableGitHubLogin) result.authMethods.push('GitHub');
    if (ld.isEnableLinuxDoLogin) result.authMethods.push('LinuxDO');
    if (ld.isEnableMailRegister) result.authMethods.push('Mail');
  }

  return result;
}

/**
 * 探测 Matrix 网关
 */
export async function probeMatrix(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const healthRes = await fetchWithRetry(`${base}/api/health`);

  const isOk =
    healthRes.status === 200 &&
    (healthRes.json?.status === 'ok' || String(healthRes.text).includes('ok'));
  return {
    panel: 'matrix',
    baseUrl: base,
    online: isOk,
    latencyMs: healthRes.ms,
    statusApiOk: healthRes.status === 200,
    healthStatus: healthRes.json?.status || (isOk ? 'ok' : 'degraded'),
    notes: '统一 API 网关，注册与邀请积分需登录控制台查看',
    error: isOk ? null : healthRes.error || `HTTP ${healthRes.status}`,
  };
}

/**
 * 探测 Relay 自研网关 / 任务积分站 (CheapCodex, NOFX 等)
 */
export async function probeRelay(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  // 探活路由: /v1/models 未带 key 预期回 401 API_KEY_REQUIRED
  const modelsRes = await fetchWithRetry(`${base}/v1/models`);
  const rootRes = await fetchWithRetry(base);

  // 401 或 200 证明网关服务在线并且正在侦听 OpenAI 路由
  const isGatewayLive = modelsRes.status === 401 || modelsRes.status === 200;
  const isRootLive = rootRes.status === 200 || rootRes.status === 301 || rootRes.status === 302;

  return {
    panel: 'relay',
    baseUrl: base,
    online: isGatewayLive || isRootLive,
    latencyMs: modelsRes.ms || rootRes.ms,
    gatewayRouteActive: isGatewayLive,
    gatewayStatus: modelsRes.status,
    rootStatus: rootRes.status,
    notes: isGatewayLive
      ? '自研网关/积分站，/v1/models 路由存活 (401 Auth Required)'
      : '站点首页可访问，未开放免登录公开接口',
    error: !isGatewayLive && !isRootLive ? modelsRes.error || `HTTP ${modelsRes.status}` : null,
  };
}

/**
 * 智能探测器：自动按优先级嗅探 4 种面板架构
 */
export async function probeSite(baseUrl, explicitPanel = null) {
  if (explicitPanel === 'newapi') return await probeNewApi(baseUrl);
  if (explicitPanel === 'vibecode') return await probeVibeCode(baseUrl);
  if (explicitPanel === 'matrix') return await probeMatrix(baseUrl);
  if (explicitPanel === 'relay') return await probeRelay(baseUrl);

  // 自动嗅探模式：优先探测 New API (/api/status)
  const newApiResult = await probeNewApi(baseUrl);
  if (newApiResult.statusApiOk) {
    return newApiResult;
  }

  // 尝试 VibeCode (/frontend-api/getConfig)
  const vibeResult = await probeVibeCode(baseUrl);
  if (vibeResult.online) {
    return vibeResult;
  }

  // 尝试 Matrix (/api/health)
  const matrixResult = await probeMatrix(baseUrl);
  if (matrixResult.online) {
    return matrixResult;
  }

  // 回落到 Relay 探活
  const relayResult = await probeRelay(baseUrl);
  if (relayResult.online) {
    return relayResult;
  }

  // 若均不通，返回探测失败汇总
  return {
    panel: 'unknown',
    baseUrl: normalizeBaseUrl(baseUrl),
    online: false,
    latencyMs: newApiResult.latencyMs,
    error: newApiResult.error || 'All 4 panel probes failed or unreachable',
  };
}

// 命令行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.log(`用法: node probe-panels.mjs <url> [panel: newapi|vibecode|matrix|relay]`);
    process.exit(1);
  }
  const panelArg = process.argv[3] || null;
  probeSite(target, panelArg)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Probe error:', err);
      process.exit(1);
    });
}
