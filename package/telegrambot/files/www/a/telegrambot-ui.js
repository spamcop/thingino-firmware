(function(){
  'use strict';
  const form = document.querySelector('form');
  if (!form) return;
  const endpoint = 'json-telegrambot.cgi';
  const container = document.querySelector('.bot-commands');

  // Build dynamic commands UI
  const table = document.createElement('table');
  table.className = 'table table-sm table-striped';
  table.innerHTML = '<thead><tr><th>Command</th><th>Description</th><th>Action</th><th></th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn btn-secondary btn-sm mb-2'; addBtn.textContent = 'Add command';
  container.appendChild(addBtn);
  container.appendChild(table);

  // Hide existing fixed rows (tb_command_0..9 etc.)
  Array.from(container.querySelectorAll('.row.g-1')).forEach(r => r.classList.add('d-none'));

  function addRow(cmd){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input class="form-control form-control-sm cmd-h" placeholder="start"/></td>'+
                   '<td><input class="form-control form-control-sm cmd-d" placeholder="Description"/></td>'+
                   '<td><input class="form-control form-control-sm cmd-e" placeholder="/usr/bin/thing"/></td>'+
                   '<td><button type="button" class="btn btn-outline-danger btn-sm">✕</button></td>';
    if (cmd){ tr.querySelector('.cmd-h').value = cmd.handle||'';
              tr.querySelector('.cmd-d').value = cmd.description||'';
              tr.querySelector('.cmd-e').value = cmd.exec||''; }
    tr.querySelector('button').onclick = ()=> tr.remove();
    tbody.appendChild(tr);
  }
  addBtn.onclick = ()=> addRow();

  function splitUsers(s){ return (s||'').trim().split(/\s+/).filter(Boolean); }

  async function load(){
    // Load structured config; fallback to flat UI JSON
    let data = null;
    try { const r = await fetch(endpoint+'?mode=structured'); data = await r.json(); } catch(e){}
    if (!data){ const r = await fetch(endpoint); data = await r.json(); }

    // Populate token/users and enabled
    const token = data.token || data.tb_token || '';
    const users = Array.isArray(data.allowed_usernames) ? data.allowed_usernames.join(' ') : (data.tb_users||'');
    const elTok = document.getElementById('tb_token'); if (elTok) elTok.value = token;
    const elUsr = document.getElementById('tb_users'); if (elUsr) elUsr.value = users;
    const elEn = document.getElementById('tb_enabled'); if (elEn) elEn.checked = (data.enabled_boot === true) || (data.tb_enabled === true) || (data.tb_enabled === 'true');

    // Populate commands
    tbody.innerHTML = '';
    const cmds = Array.isArray(data.commands) ? data.commands : (function(){
      const out=[]; for (let i=0;i<100;i++){ const h=data['tb_command_'+i],d=data['tb_description_'+i],e=data['tb_script_'+i]; if(!h&&!e&&!d) break; if(h&&e) out.push({handle:h,description:d||'',exec:e}); } return out; })();
    cmds.forEach(addRow);
  }

  async function save(ev){
    ev && ev.preventDefault();
    // Gather structured JSON
    const token = document.getElementById('tb_token')?.value.trim()||'';
    const users = splitUsers(document.getElementById('tb_users')?.value||'');
    const enabled = !!document.getElementById('tb_enabled')?.checked;
    const commands = Array.from(tbody.querySelectorAll('tr')).map(tr=>({
      handle: tr.querySelector('.cmd-h').value.trim(),
      description: tr.querySelector('.cmd-d').value.trim(),
      exec: tr.querySelector('.cmd-e').value.trim()
    })).filter(c=>c.handle && c.exec);

    const payload = { token, allowed_usernames: users, commands, enabled };
    // Include tb_enabled for backward compatibility
    payload.tb_enabled = enabled;
    try{
      const r = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if(!r.ok) throw new Error('HTTP '+r.status);
      alert('Saved.');
    }catch(e){ alert('Save failed: '+e.message); }
  }

  form.addEventListener('submit', save);
  load();
})();

