'use strict';

// Mirrors FundSummary.swift so the dashboard and the app never disagree.
// If you change a rule here, change it there too.

function partTotal(part) {
  return (part.unitCost || 0) * (part.quantity || 1);
}

function deviceSpent(device) {
  return (device.parts || [])
    .filter((p) => p.isPurchased)
    .reduce((sum, p) => sum + partTotal(p), 0);
}

function deviceOutstanding(device) {
  return (device.parts || [])
    .filter((p) => !p.isPurchased)
    .reduce((sum, p) => sum + partTotal(p), 0);
}

function saleNet(sale) {
  return (sale.grossAmount || 0) - (sale.fees || 0) - (sale.shippingCost || 0);
}

// Money should never surface as 204.60000000000002.
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Bucket months in UTC throughout. Doing this in local time and then calling
// toISOString() shifts every month back an hour under BST, which is enough to
// relabel the whole chart by one month.
function monthIndex(date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function monthlyIncome(sales, monthsBack = 6) {
  const now = new Date();
  const endIndex = monthIndex(now);
  const startIndex = endIndex - (monthsBack - 1);

  // Seed every month so gaps render as zero rather than vanishing.
  const buckets = new Map();
  for (let i = startIndex; i <= endIndex; i += 1) {
    buckets.set(i, 0);
  }

  for (const sale of sales) {
    const index = monthIndex(new Date(sale.date));
    if (index < startIndex || index > endIndex) continue;
    buckets.set(index, buckets.get(index) + saleNet(sale));
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, amount]) => ({
      month: new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)).toISOString(),
      amount: round2(amount),
    }));
}

function incomeByPlatform(sales) {
  const totals = new Map();
  for (const sale of sales) {
    const key = sale.platform || 'Other';
    totals.set(key, (totals.get(key) || 0) + saleNet(sale));
  }
  return [...totals.entries()]
    .map(([platform, amount]) => ({ platform, amount: round2(amount) }))
    .filter((entry) => entry.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

function spendByDevice(devices) {
  return devices
    .map((device) => ({ name: device.name, amount: round2(deviceSpent(device)) }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function build(snapshot) {
  const devices = snapshot.devices || [];
  const sales = snapshot.sales || [];

  const grossIn = sales.reduce((sum, s) => sum + (s.grossAmount || 0), 0);
  const deductions = sales.reduce((sum, s) => sum + (s.fees || 0) + (s.shippingCost || 0), 0);
  const totalIn = sales.reduce((sum, s) => sum + saleNet(s), 0);
  const totalOut = devices.reduce((sum, d) => sum + deviceSpent(d), 0);
  const outstanding = devices.reduce((sum, d) => sum + deviceOutstanding(d), 0);
  const balance = totalIn - totalOut;

  return {
    syncedAt: snapshot.syncedAt,
    grossIn: round2(grossIn),
    deductions: round2(deductions),
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    balance: round2(balance),
    outstanding: round2(outstanding),
    shortfall: round2(balance - outstanding),
    canAffordOutstanding: round2(balance - outstanding) >= 0,
    devicesNeedingParts: devices.filter((d) => deviceOutstanding(d) > 0).length,
    salesCount: sales.length,
    monthlyIncome: monthlyIncome(sales),
    incomeByPlatform: incomeByPlatform(sales),
    spendByDevice: spendByDevice(devices),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      symbolName: d.symbolName,
      photoHash: d.photoHash || null,
      spent: round2(deviceSpent(d)),
      outstanding: round2(deviceOutstanding(d)),
      parts: d.parts || [],
    })),
    sales: sales
      .map((s) => ({ ...s, netAmount: round2(saleNet(s)) }))
      .sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

module.exports = { build, saleNet, deviceSpent, deviceOutstanding };
