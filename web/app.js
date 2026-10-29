/* PyFire Watch — app logic */
const STATE = {
  raw: [], filtered: [], sensor: 'harmonized', cal: null, summary: null,
  page: 1, pageSize: 25, map: null, markers: null, calData: null,
};

const $ = (id) => document.getElementById(id);

/* ---------- data loading ---------- */
async function loadBundled() {
  try {
    const [h, c, s] = await Promise.all([
      fetch('./data/hotspots.json').then(r => r.ok ? r.json() : null),
      fetch('./data/calendar.json').then(r => r.ok ? r.json() : null),
      fetch('./data/summary.json').then(r => r.ok ? r.json() : null),
    ]);
    if (h && h.length) {
      STATE.raw = h; STATE.calData = c; STATE.summary = s;
      markLive(true);
      return true;
    }
  } catch (e) { /* fall through */ }
  return false;
}

function markLive(live) {
  const b = $('data-status');
  b.textContent = live ? 'Live NASA data' : 'Synthetic sample';
  b.className = 'status-badge ' + (live ? 'status-live' : 'status-synth');
}

function genSynthetic(n = 500) {
  const regions = [
    {name:'Phnom Penh', lat:11.56, lon:104.93, r:0.6},
    {name:'Siem Reap', lat:13.36, lon:103.86, r:0.5},
    {name:'Battambang', lat:13.10, lon:103.20, r:0.5},
    {name:'Kratie', lat:12.49, lon:106.02, r:0.6},
    {name:'Ratanakiri', lat:13.74, lon:106.99, r:0.5},
  ];
  const out = [];
  const end = new Date();
  for (let i = 0; i < n; i++) {
    const R = regions[Math.floor(Math.random()*regions.length)];
    const d = new Date(end.getTime() - Math.random()*30*864e5);
    const sensor = Math.random() < 0.4 ? 'MODIS' : 'VIIRS';
    const confRaw = sensor === 'MODIS' ? Math.floor(Math.random()*60)+40
                                       : ['low','nominal','high'][Math.floor(Math.random()*3)];
    out.push({
      lat: +(R.lat + (Math.random()-.5)*R.r).toFixed(4),
      lon: +(R.lon + (Math.random()-.5)*R.r).toFixed(4),
      date: d.toISOString().slice(0,10),
      conf: sensor === 'MODIS' ? confRaw : ({low:20,nominal:60,high:90}[confRaw]),
      conf_raw: confRaw, frp: +(Math.random()*200+5).toFixed(1),
      sensor, tier: String(confRaw),
      year: d.getFullYear(), week: isoWeek(d),
      region: R.name,
    });
  }
  return out;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil((((t-y)/864e5)+1)/7);
}

/* ---------- upload (client-side harmonise) ---------- */
function handleUpload(file) {
  Papa.parse = undefined;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const rows = parseCSV(text);
    if (!rows.length) { alert('Empty or invalid CSV'); return; }
    const norm = normaliseCSV(rows);
    if (!norm.length) { alert('Could not detect lat/lon columns'); return; }
    STATE.raw = norm; STATE.calData = null; STATE.summary = null;
    markLive(false);
    $('data-status').textContent = 'Uploaded CSV';
    refresh();
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g,''));
    const o = {};
    header.forEach((h, idx) => o[h] = cols[idx]);
    out.push(o);
  }
  return out;
}

function normaliseCSV(rows) {
  const sample = rows[0];
  const keys = Object.keys(sample);
  const find = (pred) => keys.find(k => pred(k.toLowerCase())) || null;
  const latK = find(k => k.includes('lat'));
  const lonK = find(k => k.includes('lon') || k.includes('lng'));
  const dateK = find(k => k.includes('date') || k.includes('time') || k.includes('acq'));
  const confK = find(k => k.includes('conf'));
  const frpK = find(k => k.includes('frp') || k.includes('power') || k.includes('bright'));
  const regionK = find(k => k.includes('region') || k.includes('country'));
  const sensorK = find(k => k.includes('sensor') || k.includes('satellite'));
  if (!latK || !lonK) return [];
  return rows.map((r, idx) => {
    const lat = parseFloat(r[latK]); const lon = parseFloat(r[lonK]);
    if (isNaN(lat) || isNaN(lon)) return null;
    let sensor = 'MODIS';
    if (sensorK) {
      const v = String(r[sensorK]).toUpperCase();
      if (v.includes('VIIRS') || v.includes('VNP') || v.includes('VJ1')) sensor = 'VIIRS';
      else if (v.includes('MODIS') || v.includes('MOD')) sensor = 'MODIS';
    }
    let confRaw = confK ? r[confK] : '';
    let confPct;
    if (sensor === 'MODIS') { confPct = parseInt(confRaw); if (isNaN(confPct)) confPct = 50; }
    else {
      const t = String(confRaw).toLowerCase();
      confPct = t.includes('high') ? 90 : t.includes('nom') ? 60 : 20;
    }
    const dstr = dateK && r[dateK] ? String(r[dateK]).slice(0,10) : new Date().toISOString().slice(0,10);
    const dd = new Date(dstr);
    return {
      lat, lon, date: dstr, conf: confPct, conf_raw: confRaw,
      frp: parseFloat(r[frpK]) || 0, sensor, tier: String(confRaw),
      year: dd.getFullYear(), week: isoWeek(dd),
      region: regionK ? (r[regionK] || 'Uploaded') : 'Uploaded',
    };
  }).filter(Boolean);
}

/* ---------- filtering ---------- */
function applyFilters() {
  const start = $('f-start').value, end = $('f-end').value;
  const region = $('f-region').value;
  const minConf = +$('f-conf').value, minFrp = +$('f-frp').value;
  let data = STATE.raw;
  // sensor filter
  if (STATE.sensor === 'MODIS') data = data.filter(d => d.sensor === 'MODIS');
  else if (STATE.sensor === 'VIIRS') data = data.filter(d => d.sensor === 'VIIRS');
  // harmonized = comparable confidence only
  if (STATE.sensor === 'harmonized') {
    data = data.filter(d => (d.sensor === 'MODIS' && d.conf >= 80) ||
                            (d.sensor === 'VIIRS' && (d.tier === 'nominal' || d.tier === 'high' || d.conf >= 60)));
  }
  data = data.filter(d => (!start || d.date >= start) && (!end || d.date <= end));
  // region filter only when the dataset actually carries region labels
  if (region !== 'ALL' && STATE.raw.some(d => d.region)) {
    data = data.filter(d => d.region === region);
  }
  data = data.filter(d => d.conf >= minConf && d.frp >= minFrp);
  STATE.filtered = data;
  renderAll();
}

function refresh() { populateRegions(); setDefaultDates(); applyFilters(); }

function populateRegions() {
  const sel = $('f-region');
  const regions = [...new Set(STATE.raw.map(d => d.region).filter(Boolean))].sort();
  sel.innerHTML = '<option value="ALL">All regions</option>';
  regions.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; sel.appendChild(o); });
}

function setDefaultDates() {
  if (!STATE.raw.length) return;
  const dates = STATE.raw.map(d => d.date).sort();
  $('f-start').value = dates[0]; $('f-end').value = dates[dates.length-1];
}

/* ---------- rendering ---------- */
function renderAll() {
  renderKPIs(); renderCalendar(); renderMap(); renderSeam(); renderTable();
}

function renderKPIs() {
  const d = STATE.filtered;
  $('k-total').textContent = d.length.toLocaleString();
  $('k-days').textContent = new Set(d.map(x => x.date)).size;
  $('k-frp').textContent = d.length ? (d.reduce((a,x)=>a+x.frp,0)/d.length).toFixed(1) : '0.0';
  $('k-conf').textContent = d.length ? Math.round(d.reduce((a,x)=>a+x.conf,0)/d.length) + '%' : '0%';
  const c = STATE.summary && STATE.summary.calibration ? STATE.summary.calibration.c_global : null;
  $('k-c').textContent = c != null ? c.toFixed(2) + '×' : (d.length ? (d.filter(x=>x.sensor==='VIIRS').length / Math.max(1,d.filter(x=>x.sensor==='MODIS').length)).toFixed(2)+'×' : '—');
}

function renderCalendar() {
  const grid = $('calendar-grid');
  grid.innerHTML = '';
  const d = STATE.filtered;
  if (!d.length) { grid.innerHTML = '<div class="muted">No data.</div>'; return; }

  // build year x week matrix
  const years = [...new Set(d.map(x => x.year))].sort();
  const matrix = {}; const maxCell = {v:0};
  years.forEach(y => { matrix[y] = {}; for (let w=1; w<=53; w++) matrix[y][w]=0; });
  d.forEach(x => { matrix[x.year][x.week] = (matrix[x.year][x.week]||0)+1; if (matrix[x.year][x.week] > maxCell.v) maxCell.v = matrix[x.year][x.week]; });
  const maxV = maxCell.v || 1;

  // header
  const header = document.createElement('div');
  header.className = 'cal-header';
  header.innerHTML = '<span></span>' + Array.from({length:53},(_,i)=>`<span>${i+1}</span>`).join('');
  grid.appendChild(header);

  years.forEach(y => {
    const row = document.createElement('div');
    row.className = 'cal-row';
    let cells = `<div class="cal-year">${y}</div>`;
    for (let w = 1; w <= 53; w++) {
      const v = matrix[y][w];
      const intensity = v / maxV;
      let cls = 'l0';
      if (v > 0) { cls = intensity > 0.75 ? 'l3' : intensity > 0.4 ? 'l2' : 'l1'; }
      // critical from bundled calData if present
      let crit = '';
      if (STATE.calData && STATE.calData.anomalies) {
        const a = STATE.calData.anomalies.find(a => a.year === y && a.week === w);
        if (a && a.level === 'critical') crit = ' crit';
      }
      cells += `<div class="cal-cell ${cls}${crit}" data-y="${y}" data-w="${w}" data-v="${v}" title="${y} W${w}: ${v}"></div>`;
    }
    row.innerHTML = cells;
    grid.appendChild(row);
  });

  $('cal-range').textContent = `${years[0]} – ${years[years.length-1]} · ${d.length} detections`;

  // click handler
  grid.querySelectorAll('.cal-cell').forEach(c => {
    c.onclick = () => {
      const y = +c.dataset.y, w = +c.dataset.w;
      const recs = d.filter(x => x.year === y && x.week === w);
      const dd = $('day-detail');
      dd.classList.remove('hidden');
      dd.innerHTML = `<b>${y} · week ${w}</b> — ${recs.length} detections<br>` +
        recs.slice(0,8).map(r => `${r.date} · ${r.sensor} · ${r.frp} MW · conf ${r.conf}`).join('<br>') +
        (recs.length > 8 ? `<br>…+${recs.length-8} more` : '');
    };
  });
}

function renderMap() {
  if (!STATE.map) {
    STATE.map = L.map('map', { center: [12.5, 105], zoom: 6 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &copy; OpenStreetMap',
      maxZoom: 16
    }).addTo(STATE.map);
    STATE.markers = L.layerGroup().addTo(STATE.map);
  }
  STATE.markers.clearLayers();
  const d = STATE.filtered;
  d.forEach(item => {
    let color = '#facc15', radius = 4;
    if (item.frp > 150) { color = '#dc2626'; radius = 8; }
    else if (item.frp > 50) { color = '#f59e0b'; radius = 6; }
    const c = L.circleMarker([item.lat, item.lon], { radius, fillColor: color,
      color: '#0f172a', weight: 1, fillOpacity: 0.85 });
    c.bindPopup(`<b>${item.sensor}</b><br>${item.date}<br>FRP ${item.frp} MW<br>Conf ${item.conf}%`);
    STATE.markers.addLayer(c);
  });
  if (d.length) {
    const bounds = L.latLngBounds(d.map(x => [x.lat, x.lon]));
    STATE.map.fitBounds(bounds, { padding: [40,40] });
  }
}

function renderSeam() {
  const canvas = $('seam-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  
  // Prefer monthly aggregation if >= 2 months; otherwise aggregate by day
  let agg = (STATE.summary && STATE.summary.raw_by_month && Object.keys(STATE.summary.raw_by_month).length >= 2) 
    ? STATE.summary.raw_by_month 
    : null;
  let isDaily = false;

  if (!agg) {
    const rawMonths = {};
    STATE.raw.forEach(x => {
      const m = x.date.slice(0,7);
      rawMonths[m] = true;
    });
    if (Object.keys(rawMonths).length >= 2) {
      agg = {};
      STATE.raw.forEach(x => {
        const m = x.date.slice(0,7);
        agg[m] = agg[m] || {MODIS:0, VIIRS:0};
        agg[m][x.sensor] = (agg[m][x.sensor]||0)+1;
      });
    } else {
      isDaily = true;
      agg = {};
      STATE.raw.forEach(x => {
        const d = x.date;
        agg[d] = agg[d] || {MODIS:0, VIIRS:0};
        agg[d][x.sensor] = (agg[d][x.sensor]||0)+1;
      });
    }
  }

  const buckets = Object.keys(agg).sort();
  if (buckets.length === 0) {
    ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif';
    ctx.fillText('No detections available to compare.', 20, H/2); return;
  }

  const maxV = Math.max(...buckets.map(b => Math.max(agg[b].MODIS, agg[b].VIIRS)), 1);
  const pad = 40, plotW = W - pad*2, plotH = H - pad*2;

  // Title / Mode indicator on canvas
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText(isDaily ? 'Daily Sensor Comparison (MODIS vs VIIRS)' : 'Monthly Seam Test (MODIS vs VIIRS)', pad, 18);

  // Axes
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.stroke();

  // Gridlines
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px monospace';
  for (let i = 0; i <= 4; i++) {
    const y = H - pad - (plotH*i/4);
    ctx.fillText(Math.round(maxV*i/4), 4, y+3);
    ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W-pad, y); ctx.stroke();
  }

  // X labels
  buckets.forEach((b, i) => {
    const x = pad + (plotW * i / Math.max(1, buckets.length - 1));
    ctx.fillStyle = '#94a3b8'; ctx.save(); ctx.translate(x, H-pad+14); ctx.rotate(-0.5);
    ctx.fillText(isDaily ? b.slice(5) : b.slice(2), -10, 0); ctx.restore();
  });

  // Lines
  function drawLine(key, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    buckets.forEach((b, i) => {
      const x = pad + (plotW * i / Math.max(1, buckets.length - 1));
      const val = agg[b][key] || 0;
      const y = H - pad - (val / maxV) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Data points
    ctx.fillStyle = color;
    buckets.forEach((b, i) => {
      const x = pad + (plotW * i / Math.max(1, buckets.length - 1));
      const val = agg[b][key] || 0;
      const y = H - pad - (val / maxV) * plotH;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    });
  }

  drawLine('MODIS', '#f59e0b');
  drawLine('VIIRS', '#3b82f6');

  // Legend
  const legendX = W - pad - 180;
  ctx.fillStyle = '#f59e0b'; ctx.fillRect(legendX, 10, 12, 4); 
  ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.fillText('MODIS (1km)', legendX + 18, 15);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(legendX + 90, 10, 12, 4); 
  ctx.fillStyle = '#94a3b8'; ctx.fillText('VIIRS (375m)', legendX + 108, 15);
}

function renderTable() {
  const tbody = $('table-body');
  tbody.innerHTML = '';
  const data = STATE.filtered;
  const start = (STATE.page-1)*STATE.pageSize;
  const page = data.slice(start, start+STATE.pageSize);
  $('table-count').textContent = `${data.length} records`;
  const tp = Math.max(1, Math.ceil(data.length/STATE.pageSize));
  $('pg-info').textContent = `Page ${STATE.page} of ${tp}`;
  $('pg-prev').disabled = STATE.page <= 1;
  $('pg-next').disabled = STATE.page >= tp;
  page.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.date}</td><td>${r.sensor}</td><td>${r.lat}</td><td>${r.lon}</td>
      <td>${r.region||'—'}</td><td>${r.conf}%</td><td>${r.frp}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- export ---------- */
function exportCSV() {
  const rows = STATE.filtered;
  if (!rows.length) { alert('No records'); return; }
  const header = ['latitude','longitude','date','sensor','confidence','frp','region'];
  const csv = [header.join(',')].concat(rows.map(r =>
    [r.lat,r.lon,r.date,r.sensor,r.conf,r.frp, (r.region||'').replace(/,/g,';')].join(','))).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'pyfire_export.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- wiring ---------- */
function wire() {
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    $('panel-'+b.dataset.tab).classList.remove('hidden');
    if (b.dataset.tab === 'map' && STATE.map) STATE.map.invalidateSize();
  });
  document.querySelectorAll('#sensor-seg .seg-btn').forEach(b => b.onclick = () => {
    document.querySelectorAll('#sensor-seg .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); STATE.sensor = b.dataset.sensor; applyFilters();
  });
  ['f-start','f-end','f-region'].forEach(id => $(id).addEventListener('change', applyFilters));
  $('f-conf').oninput = () => { $('conf-val').textContent = $('f-conf').value + '%'; applyFilters(); };
  $('f-frp').oninput = () => { $('frp-val').textContent = $('f-frp').value + ' MW'; applyFilters(); };
  $('btn-reset').onclick = () => {
    $('f-conf').value = 0; $('f-frp').value = 0; $('f-region').value = 'ALL';
    $('conf-val').textContent = '0%'; $('frp-val').textContent = '0 MW';
    setDefaultDates(); applyFilters();
  };
  $('btn-upload').onclick = () => $('csv-input').click();
  $('csv-input').onchange = (e) => { if (e.target.files[0]) handleUpload(e.target.files[0]); };
  $('btn-export').onclick = exportCSV;
  $('pg-prev').onclick = () => { if (STATE.page > 1) { STATE.page--; renderTable(); } };
  $('pg-next').onclick = () => { STATE.page++; renderTable(); };
  $('table-search').onkeyup = () => {
    const q = $('table-search').value.toLowerCase();
    if (!q) { applyFilters(); return; }
    STATE.filtered = STATE.raw.filter(x =>
      (x.region||'').toLowerCase().includes(q) || x.date.includes(q) || x.sensor.toLowerCase().includes(q));
    STATE.page = 1; renderTable();
  };
}

async function init() {
  wire();
  const ok = await loadBundled();
  if (!ok) {
    STATE.raw = genSynthetic(600);
    markLive(false);
  }
  refresh();
  STATE.page = 1;
}
init();
