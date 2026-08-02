'use strict';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const compact = (n) =>
  Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(1)}k` : `£${Math.round(n)}`;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- data

// The session lives in an HttpOnly cookie, so nothing credential-shaped is
// readable from JavaScript and there's nothing to store here.
async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });

  if (res.status === 401) {
    const err = new Error('Please sign in.');
    err.unauthorized = true;
    throw err;
  }

  if (res.status === 428) {
    // Default or admin-reset password: nothing else works until it's changed,
    // and that's done on the admin page.
    const err = new Error('Set a new password before continuing.');
    err.mustChangePassword = true;
    throw err;
  }

  if (res.status === 403) {
    const detail = await res.json().catch(() => null);
    const err = new Error(detail?.message || 'Not allowed.');
    err.forbidden = true;
    throw err;
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message || `Request failed (${res.status})`);
  }

  return res.json();
}

// ---------------------------------------------------------------- charts
//
// Both charts are single-series magnitude, so each uses one hue and needs no
// legend — the heading names the series. Bars get rounded data-ends anchored
// to the baseline; grid and axes stay recessive.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Vertical bar rising from the baseline, rounded at the top only. */
function vBarPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}

/** Horizontal bar growing from the left, rounded at the right end only. */
function hBarPath(x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w);
  if (w <= 0) return '';
  return [
    `M${x},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h - radius}`,
    `Q${x + w},${y + h} ${x + w - radius},${y + h}`,
    `L${x},${y + h}`,
    'Z',
  ].join(' ');
}

// Pick an axis top and step that land on round numbers, so ticks read
// £0/£50/£100 rather than £0/£67/£133.
function niceScale(value, targetTicks = 4) {
  if (value <= 0) return { max: 100, step: 25 };
  const rough = value / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  return { max: Math.ceil(value / step) * step, step };
}

function renderIncomeChart(months) {
  const host = $('chart-income');
  host.replaceChildren();

  const W = 720;
  const H = 240;
  const pad = { top: 12, right: 56, bottom: 30, left: 12 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const { max, step } = niceScale(Math.max(...months.map((m) => m.amount), 0));
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    role: 'img',
    'aria-label': 'Net money in by month',
  });

  // Grid lines and value labels, right-aligned so they stay clear of the bars.
  for (let value = 0; value <= max; value += step) {
    const y = pad.top + plotH - (value / max) * plotH;
    svg.appendChild(el('line', {
      x1: pad.left, y1: y, x2: pad.left + plotW, y2: y,
      stroke: 'var(--grid)', 'stroke-width': 1,
    }));
    svg.appendChild(el('text', {
      x: pad.left + plotW + 8, y: y + 4,
      fill: 'var(--ink-muted)', 'font-size': 12,
    }, compact(value)));
  }

  const slot = plotW / months.length;
  const barW = Math.min(slot * 0.55, 54);

  months.forEach((month, i) => {
    const h = max === 0 ? 0 : (month.amount / max) * plotH;
    const x = pad.left + slot * i + (slot - barW) / 2;
    const y = pad.top + plotH - h;

    if (h > 0) {
      svg.appendChild(el('path', {
        d: vBarPath(x, y, barW, h, 4),
        fill: 'var(--in)',
      }));
    }

    // Month keys are UTC-anchored; format in UTC or BST drags them back a month.
    const label = new Date(month.month).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    svg.appendChild(el('text', {
      x: x + barW / 2, y: H - 10,
      fill: 'var(--ink-muted)', 'font-size': 12, 'text-anchor': 'middle',
    }, label));

    const title = el('title', {});
    title.textContent = `${new Date(month.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}: ${gbp.format(month.amount)}`;
    svg.appendChild(el('rect', {
      x: pad.left + slot * i, y: pad.top, width: slot, height: plotH,
      fill: 'transparent',
    })).appendChild(title);
  });

  host.appendChild(svg);
}

function renderSpendChart(entries) {
  const host = $('chart-spend');
  host.replaceChildren();

  const rowH = 38;
  const W = 720;
  const H = entries.length * rowH + 12;
  const labelW = 150;
  const valueW = 90;
  const plotW = W - labelW - valueW;

  const max = Math.max(...entries.map((e) => e.amount), 1);
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    role: 'img',
    'aria-label': 'Money spent on parts by device',
  });

  entries.forEach((entry, i) => {
    const y = i * rowH + 6;
    const barH = 24;
    const w = (entry.amount / max) * plotW;

    svg.appendChild(el('text', {
      x: labelW - 12, y: y + barH / 2 + 4,
      fill: 'var(--ink-secondary)', 'font-size': 13, 'text-anchor': 'end',
    }, entry.name));

    svg.appendChild(el('path', {
      d: hBarPath(labelW, y, w, barH, 4),
      fill: 'var(--out)',
    }));

    svg.appendChild(el('text', {
      x: labelW + w + 10, y: y + barH / 2 + 4,
      fill: 'var(--ink-muted)', 'font-size': 12,
    }, gbp.format(entry.amount)));
  });

  host.appendChild(svg);
}

// ---------------------------------------------------------------- render

function render(data) {
  const hasData = data.salesCount > 0 || data.devices.length > 0;
  $('empty-note').hidden = hasData;

  $('synced-at').textContent = data.syncedAt
    ? `Last synced ${new Date(data.syncedAt).toLocaleString('en-GB')}`
    : 'Never synced';

  $('stat-in').textContent = gbp.format(data.totalIn);
  $('stat-out').textContent = gbp.format(data.totalOut);
  $('stat-balance').textContent = gbp.format(data.balance);
  $('stat-in-note').textContent = data.deductions > 0
    ? `${gbp.format(data.grossIn)} in sales, less ${gbp.format(data.deductions)} fees and postage`
    : 'From all your sales';

  // Outstanding parts
  const outstandingCard = $('outstanding-card');
  outstandingCard.hidden = data.outstanding <= 0;
  if (data.outstanding > 0) {
    $('outstanding-amount').textContent = gbp.format(data.outstanding);
    $('outstanding-devices').textContent =
      `Across ${data.devicesNeedingParts} device${data.devicesNeedingParts === 1 ? '' : 's'}`;
    $('affordability').textContent = data.canAffordOutstanding
      ? `Covered, with ${gbp.format(data.shortfall)} left over`
      : `You need ${gbp.format(Math.abs(data.shortfall))} more to cover it`;
    $('affordability').style.color = data.canAffordOutstanding ? 'var(--in)' : 'var(--pending)';
  }

  renderIncomeChart(data.monthlyIncome);

  $('spend-section').hidden = data.spendByDevice.length === 0;
  if (data.spendByDevice.length) renderSpendChart(data.spendByDevice);

  // Platform breakdown — a short ranked list reads better than a pie here.
  const platformCard = $('platform-card');
  platformCard.hidden = data.incomeByPlatform.length < 2;
  $('platform-list').replaceChildren(
    ...data.incomeByPlatform.map((entry) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = entry.platform;
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = gbp.format(entry.amount);
      li.append(label, amount);
      return li;
    })
  );

  // Devices
  $('devices-card').hidden = data.devices.length === 0;
  $('devices-list').replaceChildren(
    ...data.devices.map((device) => {
      const li = document.createElement('li');

      // Photos are served from /api/photos/<hash> behind the same session
      // cookie as everything else, so the browser sends it automatically.
      const label = document.createElement('span');
      label.className = 'device-label';
      if (device.photoHash) {
        const img = document.createElement('img');
        img.className = 'device-thumb';
        img.src = `/api/photos/${device.photoHash}`;
        img.alt = '';
        img.loading = 'lazy';
        // A photo that's referenced but not uploaded yet shouldn't leave a
        // broken-image icon in the list.
        img.addEventListener('error', () => img.remove());
        label.append(img);
      }
      const name = document.createElement('span');
      name.textContent = `${device.name} · ${device.status}`;
      label.append(name);
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = device.outstanding > 0
        ? `${gbp.format(device.outstanding)} to buy`
        : `${gbp.format(device.spent)} spent`;
      li.append(label, amount);
      return li;
    })
  );

  // Sales table
  $('sales-section').hidden = data.sales.length === 0;
  const body = document.querySelector('#sales-table tbody');
  body.replaceChildren(
    ...data.sales.map((sale) => {
      const tr = document.createElement('tr');
      const cells = [
        [sale.title, ''],
        [sale.platform, ''],
        [new Date(sale.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), ''],
        [gbp.format(sale.grossAmount), 'num'],
        [gbp.format(sale.netAmount), 'num net'],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.appendChild(td);
      }
      return tr;
    })
  );
}

// ---------------------------------------------------------------- boot

function showLogin(message) {
  $('dashboard').hidden = true;
  $('login').hidden = false;
  const error = $('login-error');
  error.hidden = !message;
  error.textContent = message || '';
}

async function load() {
  try {
    const data = await api('/api/summary');
    $('login').hidden = true;
    $('dashboard').hidden = false;
    render(data);
  } catch (err) {
    // The admin account manages the server rather than using it, so it has no
    // fund to show. Point it somewhere useful instead of at an error.
    if (err.forbidden || err.mustChangePassword) {
      window.location.href = '/admin';
      return;
    }
    showLogin(err.unauthorized ? '' : err.message);
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const button = $('login-button');
  const password = $('password-input');
  button.disabled = true;
  button.textContent = 'Signing in…';

  try {
    await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('username-input').value.trim(),
        password: password.value,
      }),
    });
    password.value = '';
    await load();
  } catch (err) {
    // A 401 here means bad credentials, not an expired session.
    if (err.forbidden || err.mustChangePassword) {
      window.location.href = '/admin';
      return;
    }
    showLogin(err.unauthorized ? 'Incorrect email or password.' : err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

$('sign-out').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  showLogin('');
});

load();
