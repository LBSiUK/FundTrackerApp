'use strict';

// Admin interface. Same session cookie as the dashboard; the difference is that
// every /api/admin route additionally checks the account's role server-side, so
// nothing here is load-bearing for security — hiding a button is convenience,
// not a control.

const $ = (id) => document.getElementById(id);

const state = { you: null, editing: null };

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 401) {
    const err = new Error('Please sign in.');
    err.unauthorized = true;
    throw err;
  }
  if (res.status === 403) {
    const err = new Error('Admin access required.');
    err.forbidden = true;
    throw err;
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message || `Request failed (${res.status})`);
  }

  return res.status === 204 ? null : res.json();
}

function showError(message) {
  const box = $('admin-error');
  box.hidden = !message;
  box.textContent = message || '';
}

function date(value) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString('en-GB') : 'Never';
}

function button(label, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.appendChild(td);
  return td;
}

// ---------------------------------------------------------------- codes

async function loadInvites() {
  const { invites } = await api('/api/admin/invites');
  const body = document.querySelector('#invites-table tbody');
  $('invites-empty').hidden = invites.length > 0;

  body.replaceChildren(
    ...invites.map((invite) => {
      const row = document.createElement('tr');

      const status = cell(row, invite.status);
      status.className = `status status-${invite.status}`;

      cell(row, invite.note || '—');
      cell(row, date(invite.createdAt));
      cell(row, date(invite.expiresAt));
      cell(row, invite.usedBy || '—');

      const actions = document.createElement('td');
      actions.appendChild(button('Revoke', 'ghost danger', async () => {
        if (!confirm('Revoke this code?')) return;
        await run(() => api(`/api/admin/invites/${invite.id}`, { method: 'DELETE' }));
      }));
      row.appendChild(actions);

      return row;
    })
  );
}

async function generateCode() {
  const note = prompt('Optional note (who is this for?)') ?? '';
  await run(async () => {
    const issued = await api('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    $('new-code').textContent = issued.code;
    $('new-code-card').hidden = false;
  });
}

// ---------------------------------------------------------------- accounts

async function loadAccounts() {
  const { accounts, you } = await api('/api/admin/accounts');
  state.you = you;
  $('signed-in-as').textContent = `Signed in as ${you}`;

  const body = document.querySelector('#accounts-table tbody');
  body.replaceChildren(
    ...accounts.map((account) => {
      const row = document.createElement('tr');
      const isSelf = account.username === you;

      cell(row, account.username + (isSelf ? ' (you)' : ''));

      const role = cell(row, account.role);
      role.className = account.role === 'admin' ? 'status status-admin' : '';

      const active = cell(row, account.active ? 'active' : 'disabled');
      active.className = account.active ? 'status status-active' : 'status status-expired';

      cell(row, String(account.deviceCount)).className = 'num';
      cell(row, date(account.createdAt));

      const actions = document.createElement('td');
      actions.className = 'row-actions';

      actions.appendChild(button('Edit', 'ghost', () => openAccountDialog(account)));

      if (!isSelf) {
        actions.appendChild(button(account.active ? 'Disable' : 'Enable', 'ghost', async () => {
          await run(() => api(`/api/admin/accounts/${encodeURIComponent(account.username)}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: !account.active }),
          }));
        }));

        actions.appendChild(button(account.role === 'admin' ? 'Make user' : 'Make admin', 'ghost', async () => {
          await run(() => api(`/api/admin/accounts/${encodeURIComponent(account.username)}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: account.role === 'admin' ? 'user' : 'admin' }),
          }));
        }));

        actions.appendChild(button('Delete', 'ghost danger', async () => {
          if (!confirm(`Delete ${account.username}? Their devices are revoked too.`)) return;
          await run(() => api(`/api/admin/accounts/${encodeURIComponent(account.username)}`, {
            method: 'DELETE',
          }));
        }));
      }

      row.appendChild(actions);
      return row;
    })
  );
}

function openAccountDialog(account) {
  state.editing = account || null;
  $('account-dialog-title').textContent = account ? `Edit ${account.username}` : 'Create account';
  $('account-email').value = account ? account.username : '';
  $('account-email').disabled = Boolean(account);
  $('account-password').value = '';
  $('account-password').required = !account;
  $('account-password-label').textContent = account ? 'New password (leave blank to keep)' : 'Password';
  $('account-admin').checked = account ? account.role === 'admin' : false;
  $('account-admin').disabled = Boolean(account && account.username === state.you);
  $('account-error').hidden = true;
  $('account-dialog').showModal();
}

async function saveAccount() {
  const email = $('account-email').value.trim().toLowerCase();
  const password = $('account-password').value;
  const isAdmin = $('account-admin').checked;
  const error = $('account-error');

  try {
    if (state.editing) {
      const body = {};
      if (password) body.password = password;
      if (isAdmin !== (state.editing.role === 'admin')) body.role = isAdmin ? 'admin' : 'user';

      if (Object.keys(body).length > 0) {
        await api(`/api/admin/accounts/${encodeURIComponent(state.editing.username)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
    } else {
      await api('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ email, password, role: isAdmin ? 'admin' : 'user' }),
      });
    }

    $('account-dialog').close();
    await refresh();
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message;
  }
}

// ---------------------------------------------------------------- devices

async function loadDevices() {
  const { devices } = await api('/api/admin/devices');
  const body = document.querySelector('#devices-table tbody');
  $('devices-empty').hidden = devices.length > 0;

  body.replaceChildren(
    ...devices.map((device) => {
      const row = document.createElement('tr');
      cell(row, device.name);
      cell(row, device.user);
      cell(row, date(device.createdAt));
      cell(row, dateTime(device.lastSeenAt));

      const actions = document.createElement('td');
      actions.appendChild(button('Revoke', 'ghost danger', async () => {
        if (!confirm(`Revoke ${device.name}? It will stop syncing.`)) return;
        await run(() => api(`/api/admin/devices/${device.id}`, { method: 'DELETE' }));
      }));
      row.appendChild(actions);
      return row;
    })
  );
}

// ---------------------------------------------------------------- boot

/** Runs an action, then refreshes, surfacing any failure in one place. */
async function run(action) {
  try {
    showError('');
    await action();
    await refresh();
  } catch (err) {
    if (err.unauthorized) return showLogin('');
    if (err.forbidden) return showForbidden();
    showError(err.message);
  }
}

async function refresh() {
  await Promise.all([loadAccounts(), loadInvites(), loadDevices()]);
}

function showLogin(message) {
  $('admin').hidden = true;
  $('forbidden').hidden = true;
  $('login').hidden = false;
  const error = $('login-error');
  error.hidden = !message;
  error.textContent = message || '';
}

function showForbidden() {
  $('admin').hidden = true;
  $('login').hidden = true;
  $('forbidden').hidden = false;
}

async function load() {
  try {
    const me = await api('/api/auth/me');
    if (me.role !== 'admin') return showForbidden();

    $('login').hidden = true;
    $('forbidden').hidden = true;
    $('admin').hidden = false;
    await refresh();
  } catch (err) {
    if (err.forbidden) return showForbidden();
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
      body: JSON.stringify({
        username: $('username-input').value.trim(),
        password: password.value,
      }),
    });
    password.value = '';
    await load();
  } catch (err) {
    showLogin(err.unauthorized ? 'Incorrect email or password.' : err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  showLogin('');
}

$('sign-out').addEventListener('click', signOut);
$('forbidden-signout').addEventListener('click', signOut);
$('new-code-button').addEventListener('click', generateCode);
$('new-account-button').addEventListener('click', () => openAccountDialog(null));
$('account-save').addEventListener('click', saveAccount);
$('account-cancel').addEventListener('click', () => $('account-dialog').close());
$('purge-invites').addEventListener('click', async () => {
  if (!confirm('Remove used and expired codes from the list?')) return;
  await run(() => api('/api/admin/invites/purge', { method: 'POST' }));
});
$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('new-code').textContent);
    $('copy-code').textContent = 'Copied';
    setTimeout(() => { $('copy-code').textContent = 'Copy'; }, 1500);
  } catch {
    // Clipboard needs a secure context and permission; the code is on screen
    // to be read either way.
  }
});

load();
