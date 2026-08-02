'use strict';

// Admin interface.
//
// Built for a server with many accounts: the list is searched and paged
// server-side rather than loaded whole, and devices are only fetched for the
// one account you've selected. Nothing here is load-bearing for security —
// every /api/admin route checks the role itself, so hiding a button is
// convenience only.

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 25;

const state = {
  you: null,
  search: '',
  offset: 0,
  total: 0,
  selectedId: null,
  editing: null,
};

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
  if (res.status === 428) {
    const err = new Error('Password change required.');
    err.mustChangePassword = true;
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

const showError = (message) => {
  const box = $('admin-error');
  box.hidden = !message;
  box.textContent = message || '';
};

const date = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const dateTime = (value) => (value ? new Date(value).toLocaleString('en-GB') : 'Never');

function button(label, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function cell(row, text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  row.appendChild(td);
  return td;
}

// ---------------------------------------------------------------- accounts

async function loadAccounts() {
  const query = new URLSearchParams({
    search: state.search,
    limit: String(PAGE_SIZE),
    offset: String(state.offset),
  });
  const data = await api(`/api/admin/accounts?${query}`);

  state.you = data.you;
  state.total = data.total;
  $('signed-in-as').textContent = `Signed in as ${data.you.username}`;
  $('accounts-empty').hidden = data.accounts.length > 0;

  const body = document.querySelector('#accounts-table tbody');
  body.replaceChildren(
    ...data.accounts.map((account) => {
      const row = document.createElement('tr');
      const isSelf = account.id === data.you.id;
      if (account.id === state.selectedId) row.className = 'selected';

      const name = cell(row, account.username + (isSelf ? ' (you)' : ''));
      name.className = 'link-cell';
      name.addEventListener('click', () => selectAccount(account.id));

      cell(row, account.role, account.role === 'admin' ? 'status status-admin' : '');
      cell(
        row,
        account.mustChangePassword ? 'must change password' : account.active ? 'active' : 'disabled',
        account.active ? 'status status-active' : 'status status-expired'
      );
      cell(row, String(account.deviceCount), 'num');
      cell(row, date(account.lastLoginAt));

      const actions = document.createElement('td');
      actions.className = 'row-actions';
      actions.appendChild(button('Edit', 'ghost', () => openAccountDialog(account)));

      if (!isSelf) {
        actions.appendChild(
          button(account.active ? 'Disable' : 'Enable', 'ghost', () =>
            run(() =>
              api(`/api/admin/accounts/${account.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ active: !account.active }),
              })
            )
          )
        );
        actions.appendChild(
          button(account.role === 'admin' ? 'Make user' : 'Make admin', 'ghost', () =>
            run(() =>
              api(`/api/admin/accounts/${account.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ role: account.role === 'admin' ? 'user' : 'admin' }),
              })
            )
          )
        );
        actions.appendChild(
          button('Delete', 'ghost danger', () => {
            if (!confirm(`Delete ${account.username}? Their devices, records and photos go too.`)) return;
            if (account.id === state.selectedId) closeDetail();
            return run(() => api(`/api/admin/accounts/${account.id}`, { method: 'DELETE' }));
          })
        );
      }

      row.appendChild(actions);
      return row;
    })
  );

  const from = state.total === 0 ? 0 : state.offset + 1;
  const to = Math.min(state.offset + PAGE_SIZE, state.total);
  $('page-info').textContent = `${from}–${to} of ${state.total}`;
  $('prev-page').disabled = state.offset === 0;
  $('next-page').disabled = state.offset + PAGE_SIZE >= state.total;
}

function openAccountDialog(account) {
  state.editing = account || null;
  $('account-dialog-title').textContent = account ? `Edit ${account.username}` : 'Create account';
  $('account-username').value = account ? account.username : '';
  $('account-password').value = '';
  $('account-confirm').value = '';
  $('account-password').required = !account;
  $('account-confirm').required = !account;
  $('account-password-label').textContent = account ? 'New password (leave blank to keep)' : 'Password';
  $('account-admin').checked = account ? account.role === 'admin' : false;
  $('account-admin').disabled = Boolean(account && state.you && account.id === state.you.id);
  $('account-error').hidden = true;
  $('account-dialog').showModal();
}

async function saveAccount() {
  const username = $('account-username').value.trim().toLowerCase();
  const password = $('account-password').value;
  const confirmPassword = $('account-confirm').value;
  const isAdmin = $('account-admin').checked;
  const error = $('account-error');

  // Checked here for a fast answer; the server checks it again, because a
  // password you can't reproduce is indistinguishable from a lost account.
  if (password && password !== confirmPassword) {
    error.hidden = false;
    error.textContent = "The passwords don't match.";
    return;
  }

  try {
    if (state.editing) {
      const body = {};
      if (username && username !== state.editing.username) body.username = username;
      if (password) {
        body.password = password;
        body.confirmPassword = confirmPassword;
      }
      if (isAdmin !== (state.editing.role === 'admin')) body.role = isAdmin ? 'admin' : 'user';

      if (Object.keys(body).length > 0) {
        await api(`/api/admin/accounts/${state.editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
    } else {
      await api('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ username, password, confirmPassword, role: isAdmin ? 'admin' : 'user' }),
      });
    }

    $('account-dialog').close();
    await refresh();
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message;
  }
}

// ---------------------------------------------------------------- one account

async function selectAccount(id) {
  state.selectedId = id;
  await refresh();
  $('detail-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDetail() {
  state.selectedId = null;
  $('detail-card').hidden = true;
}

async function loadDetail() {
  if (!state.selectedId) {
    $('detail-card').hidden = true;
    return;
  }

  let data;
  try {
    data = await api(`/api/admin/accounts/${state.selectedId}`);
  } catch (err) {
    // Most likely deleted from under us.
    closeDetail();
    if (!err.unauthorized && !err.forbidden) showError(err.message);
    return;
  }

  $('detail-card').hidden = false;
  $('detail-title').textContent = data.account.username;
  $('detail-fund').textContent = data.fund.syncedAt
    ? `${data.fund.deviceCount} devices, ${data.fund.saleCount} sales — synced ${dateTime(data.fund.syncedAt)}`
    : 'Never synced';
  $('detail-photos').textContent = data.photos.count
    ? `${data.photos.count} (${(data.photos.bytes / 1024 / 1024).toFixed(1)} MB)`
    : 'None';
  $('detail-created').textContent = date(data.account.createdAt);

  $('devices-empty').hidden = data.devices.length > 0;
  const body = document.querySelector('#devices-table tbody');
  body.replaceChildren(
    ...data.devices.map((device) => {
      const row = document.createElement('tr');
      cell(row, device.name);
      cell(row, date(device.createdAt));
      cell(row, dateTime(device.lastSeenAt));

      const actions = document.createElement('td');
      actions.appendChild(
        button('Revoke', 'ghost danger', () => {
          if (!confirm(`Revoke ${device.name}? It will stop syncing.`)) return;
          return run(() => api(`/api/admin/devices/${device.id}`, { method: 'DELETE' }));
        })
      );
      row.appendChild(actions);
      return row;
    })
  );
}

// ---------------------------------------------------------------- codes

async function loadInvites() {
  const { invites } = await api('/api/admin/invites');
  $('invites-empty').hidden = invites.length > 0;

  const body = document.querySelector('#invites-table tbody');
  body.replaceChildren(
    ...invites.map((invite) => {
      const row = document.createElement('tr');
      cell(row, invite.status, `status status-${invite.status}`);
      cell(row, invite.note || '—');
      cell(row, date(invite.createdAt));
      cell(row, date(invite.expiresAt));
      cell(row, invite.usedByName || '—');

      const actions = document.createElement('td');
      actions.appendChild(
        button('Revoke', 'ghost danger', () => {
          if (!confirm('Revoke this code?')) return;
          return run(() => api(`/api/admin/invites/${invite.id}`, { method: 'DELETE' }));
        })
      );
      row.appendChild(actions);
      return row;
    })
  );
}

async function generateCode() {
  const note = prompt('Optional note (who is this for?)') ?? '';
  await run(async () => {
    const issued = await api('/api/admin/invites', { method: 'POST', body: JSON.stringify({ note }) });
    $('new-code').textContent = issued.code;
    $('new-code-card').hidden = false;
  });
}

// ---------------------------------------------------------------- boot

async function run(action) {
  try {
    showError('');
    await action();
    await refresh();
  } catch (err) {
    if (err.unauthorized) return showLogin('');
    if (err.mustChangePassword) return showChangePassword('');
    if (err.forbidden) return showForbidden();
    showError(err.message);
  }
}

async function refresh() {
  await loadAccounts();
  await Promise.all([loadDetail(), loadInvites()]);
}

function only(id) {
  for (const section of ['login', 'change-password', 'forbidden', 'admin']) {
    $(section).hidden = section !== id;
  }
}

function showLogin(message) {
  only('login');
  const error = $('login-error');
  error.hidden = !message;
  error.textContent = message || '';
}

function showChangePassword(message) {
  only('change-password');
  const error = $('change-error');
  error.hidden = !message;
  error.textContent = message || '';
}

const showForbidden = () => only('forbidden');

async function load() {
  try {
    const me = await api('/api/auth/me');
    if (me.mustChangePassword) return showChangePassword('');
    if (me.role !== 'admin') return showForbidden();

    only('admin');
    await refresh();
  } catch (err) {
    if (err.mustChangePassword) return showChangePassword('');
    if (err.forbidden) return showForbidden();
    showLogin(err.unauthorized ? '' : err.message);
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('login-button');
  const password = $('password-input');
  submit.disabled = true;
  submit.textContent = 'Signing in…';

  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username-input').value.trim(), password: password.value }),
    });
    password.value = '';
    if (result.mustChangePassword) return showChangePassword('');
    await load();
  } catch (err) {
    showLogin(err.unauthorized ? 'Incorrect username or password.' : err.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});

$('change-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('change-button');
  submit.disabled = true;

  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('current-password').value,
        password: $('new-password').value,
        confirmPassword: $('confirm-password').value,
      }),
    });
    for (const id of ['current-password', 'new-password', 'confirm-password']) $(id).value = '';
    await load();
  } catch (err) {
    showChangePassword(err.message);
  } finally {
    submit.disabled = false;
  }
});

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  state.selectedId = null;
  showLogin('');
}

let searchTimer;
$('account-search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  // Debounced: this hits the server on every keystroke otherwise.
  searchTimer = setTimeout(() => {
    state.search = event.target.value;
    state.offset = 0;
    run(async () => {});
  }, 200);
});

$('prev-page').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - PAGE_SIZE);
  run(async () => {});
});

$('next-page').addEventListener('click', () => {
  state.offset += PAGE_SIZE;
  run(async () => {});
});

$('sign-out').addEventListener('click', signOut);
$('forbidden-signout').addEventListener('click', signOut);
$('close-detail').addEventListener('click', closeDetail);
$('new-code-button').addEventListener('click', generateCode);
$('new-account-button').addEventListener('click', () => openAccountDialog(null));
$('account-save').addEventListener('click', saveAccount);
$('account-cancel').addEventListener('click', () => $('account-dialog').close());
$('purge-invites').addEventListener('click', () => {
  if (!confirm('Remove used and expired codes from the list?')) return;
  return run(() => api('/api/admin/invites/purge', { method: 'POST' }));
});
$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('new-code').textContent);
    $('copy-code').textContent = 'Copied';
    setTimeout(() => {
      $('copy-code').textContent = 'Copy';
    }, 1500);
  } catch {
    // Clipboard needs a secure context and permission; the code is on screen
    // to be read either way.
  }
});

load();
