const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;

class HcnsecPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'hcnsec',
      name: 'HCNSEC',
      description: 'HCNSEC API 每日自动签到与余额查询',
      url: 'https://api.hcnsec.cn',
      loginUrl: 'https://api.hcnsec.cn/login',
      enabled: true,
    });
  }

  async onCheckin({ log }) {
    const username = process.env.HCNSEC_USERNAME;
    const password = process.env.HCNSEC_PASSWORD;

    if (!username || !password) {
      throw new Error(
        '缺少 HCNSEC 账号密码！请在 .env 文件中配置 HCNSEC_USERNAME 和 HCNSEC_PASSWORD。'
      );
    }

    log(`正在登录 HCNSEC (用户: ${username})...`);
    const loginRes = await fetch(`${this.url}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const cookieHeader = loginRes.headers.get('set-cookie');
    const loginData = await loginRes.json().catch(() => null);

    if (!loginData || !loginData.success) {
      throw new Error(`HCNSEC 登录失败: ${loginData?.message || loginRes.statusText}`);
    }

    const userId = loginData.data?.id;
    // Extract session cookie (e.g. session=...)
    let cookie = '';
    if (cookieHeader) {
      const match = cookieHeader.match(/([^;=\s]+=[^;]+)/);
      cookie = match ? match[0] : cookieHeader.split(';')[0];
    }

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'New-Api-User': String(userId),
    };

    // 1. 执行每日签到
    log('正在执行每日签到请求...');
    const checkinRes = await fetch(`${this.url}/api/user/checkin`, {
      method: 'POST',
      headers: authHeaders,
    });
    const checkinData = await checkinRes.json().catch(() => null);

    // 2. 查询当前用户余额
    log('正在获取账户最新额度...');
    const selfRes = await fetch(`${this.url}/api/user/self`, {
      headers: authHeaders,
    });
    const selfData = await selfRes.json().catch(() => null);

    let balance = null;
    if (selfData?.data?.quota !== undefined) {
      balance = `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }

    let message = '今日已签到';
    if (checkinData?.success) {
      message = checkinData.message || '签到成功';
    } else if (checkinData?.message) {
      message = checkinData.message;
    }

    return {
      success: true,
      message,
      balance,
    };
  }
}

module.exports = HcnsecPlugin;
