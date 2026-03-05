/* ============================================================
   RISK ASSESSMENT — ServiceNow UI Page JavaScript
   - Carica u_risk_assessment_custom via sys_id
   - Legge i controlli dalla tabella M2M u_m2m_u_risk_asmt_control
   - Salva la valutazione nel campo u_Risultato della M2M
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     COSTANTI
  ---------------------------------------------------------- */
  var RA_TABLE  = 'u_risk_assessment_custom';
  var M2M_TABLE = 'u_m2m_u_risk_asmt_control';
  /* Campo della M2M che punta al risk assessment */
  var M2M_RA_FIELD      = 'u_risk_assessment_custom';
  /* Campo della M2M che punta al controllo */
  var M2M_CTRL_FIELD    = 'u_sn_compliance_control';
  /* Campo della M2M che contiene la valutazione da compilare */
  var M2M_RESULT_FIELD  = 'u_Risultato';

  var RISK_MATRIX = {
    alto:  { alto: 'alto',  medio: 'alto',  basso: 'medio' },
    medio: { alto: 'alto',  medio: 'medio', basso: 'basso' },
    basso: { alto: 'medio', medio: 'basso', basso: 'basso' }
  };

  /* sys_id del risk assessment corrente */
  var _sysId = null;
  /* Snapshot dei record M2M caricati (per annulla modifiche) */
  var _m2mRecords = [];
  /* Snapshot dei valori rischio inerente (per annulla modifiche) */
  var _raSnapshot = null;

  /* ----------------------------------------------------------
     UTILITY: sys_id dall'URL o dal campo Jelly
  ---------------------------------------------------------- */
  function getSysId() {
    var el = document.getElementById('ra_sys_id');
    if (el && el.value && el.value !== '${sysparm_sys_id}') {
      return el.value.trim();
    }
    var params = new URLSearchParams(window.location.search);
    return params.get('sys_id') || params.get('sysparm_sys_id') || '';
  }

  /* ----------------------------------------------------------
     UTILITY: Table REST API
  ---------------------------------------------------------- */
  function callApi(method, url, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      if (window.g_ck) xhr.setRequestHeader('X-UserToken', window.g_ck);

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (_) { resolve({}); }
        } else {
          var msg = 'Errore HTTP ' + xhr.status;
          try {
            var b = JSON.parse(xhr.responseText);
            if (b && b.error && b.error.message) msg = b.error.message;
          } catch (_) {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = function () { reject(new Error('Errore di rete')); };
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  /* ----------------------------------------------------------
     CARICAMENTO — risk assessment + M2M in parallelo
  ---------------------------------------------------------- */
  function loadAll() {
    showLoading(true);

    var raUrl = '/api/now/table/' + RA_TABLE + '/' + _sysId
      + '?sysparm_display_value=all'
      + '&sysparm_fields=sys_id,u_impatto_inerente231,u_probabilita_inerente231,u_rischio_inerente';

    var m2mUrl = '/api/now/table/' + M2M_TABLE
      + '?sysparm_query=' + M2M_RA_FIELD + '=' + _sysId
      + '&sysparm_display_value=all'
      + '&sysparm_fields=sys_id,' + M2M_CTRL_FIELD + ',' + M2M_RESULT_FIELD
      + '&sysparm_limit=50';

    Promise.all([callApi('GET', raUrl), callApi('GET', m2mUrl)])
      .then(function (results) {
        var raRec  = results[0].result;
        var m2mRec = results[1].result || [];

        if (!raRec) throw new Error('Record risk assessment non trovato');

        _raSnapshot = raRec;
        _m2mRecords = m2mRec;

        /* Rendi visibile il form PRIMA di popolare,
           così getElementById trova gli elementi nel DOM attivo */
        showLoading(false);

        populateRischioFields(raRec);
        renderControls(m2mRec);
      })
      .catch(function (err) {
        showFatalError('Impossibile caricare i dati: ' + err.message);
      });
  }

  /* ----------------------------------------------------------
     RISCHIO INERENTE — popolamento e calcolo
  ---------------------------------------------------------- */
  function populateRischioFields(rec) {
    function val(f) {
      var field = rec[f];
      if (!field) return '';
      return typeof field === 'object' ? (field.value || '') : field;
    }

    setSelectValue('impatto_inerente',     val('u_impatto_inerente231'));
    setSelectValue('probabilita_inerente', val('u_probabilita_inerente231'));

    var label = document.getElementById('ra-record-label');
    if (label) label.textContent = 'Record: ' + _sysId;

    updateRischioDisplay();
  }

  function updateRischioDisplay() {
    var probEl   = document.getElementById('probabilita_inerente');
    var impactEl = document.getElementById('impatto_inerente');
    var display  = document.getElementById('rischio_inerente_display');
    var hidden   = document.getElementById('rischio_inerente');

    /* Se uno degli elementi non è ancora nel DOM, non fare nulla */
    if (!probEl || !impactEl || !display || !hidden) return;

    var prob   = probEl.value;
    var impact = impactEl.value;
    var risk   = (RISK_MATRIX[prob] && RISK_MATRIX[prob][impact]) ? RISK_MATRIX[prob][impact] : null;
    var labels = { alto: 'ALTO', medio: 'MEDIO', basso: 'BASSO' };

    display.innerHTML = '';
    display.className = 'ra-computed-field';
    hidden.value = '';

    if (risk) {
      display.classList.add(risk);
      hidden.value = risk;
      var span = document.createElement('span');
      span.className   = 'ra-computed-text';
      span.textContent = labels[risk];
      display.appendChild(span);
    } else {
      var ph = document.createElement('span');
      ph.className   = 'ra-computed-placeholder';
      ph.textContent = 'Calcolato automaticamente';
      display.appendChild(ph);
    }
  }

  /* ----------------------------------------------------------
     RENDERING DINAMICO DEI CONTROLLI
     Un record M2M → una riga con nome controllo + select valutazione
  ---------------------------------------------------------- */
  function renderControls(m2mRecords) {
    var grid = document.getElementById('ra-controls-grid');
    grid.innerHTML = '';

    if (!m2mRecords.length) {
      grid.innerHTML =
        '<div class="ra-no-controls">' +
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<line x1="12" y1="8" x2="12" y2="12"/>' +
            '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
          '</svg>' +
          '<p>Nessun controllo associato a questo risk assessment.</p>' +
        '</div>';
      return;
    }

    m2mRecords.forEach(function (rec, idx) {
      var ctrlField    = rec[M2M_CTRL_FIELD];
      var risultField  = rec[M2M_RESULT_FIELD];

      var controlName  = ctrlField
        ? (ctrlField.display_value || ctrlField.value || '—')
        : '—';
      var risultato    = risultField
        ? (risultField.value || '')
        : '';
      var m2mSysId     = rec.sys_id;
      var num          = 'C' + (idx + 1);

      var row = document.createElement('div');
      row.className = 'ra-control-row';
      row.dataset.m2mSysId = m2mSysId;

      row.innerHTML =
        '<div class="ra-control-badge">' +
          '<span class="ra-control-num">' + escapeHtml(num) + '</span>' +
        '</div>' +
        '<div class="ra-control-fields">' +
          '<div class="ra-field-group">' +
            '<label class="ra-label">Controllo</label>' +
            '<div class="ra-control-chip">' +
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
              '</svg>' +
              '<span>' + escapeHtml(controlName) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="ra-field-group">' +
            '<label class="ra-label">' +
              'Valutazione <span class="ra-required">*</span>' +
            '</label>' +
            '<div class="ra-select-wrapper">' +
              '<select class="ra-select ra-risultato-select">' +
                '<option value="">— Seleziona —</option>' +
                '<option value="1"' + (risultato === '1' ? ' selected' : '') + '>1 — Bassa efficacia</option>' +
                '<option value="2"' + (risultato === '2' ? ' selected' : '') + '>2 — Media efficacia</option>' +
                '<option value="3"' + (risultato === '3' ? ' selected' : '') + '>3 — Alta efficacia</option>' +
              '</select>' +
              '<div class="ra-select-arrow">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                  '<polyline points="6 9 12 15 18 9"/>' +
                '</svg>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      grid.appendChild(row);
    });
  }

  /* ----------------------------------------------------------
     VALIDAZIONE
  ---------------------------------------------------------- */
  function validate() {
    var rows = document.querySelectorAll('.ra-control-row[data-m2m-sys-id]');
    var errors = [];
    rows.forEach(function (row, idx) {
      var sel = row.querySelector('.ra-risultato-select');
      if (sel && !sel.value) {
        errors.push('Seleziona una valutazione per C' + (idx + 1));
      }
    });
    return errors;
  }

  /* ----------------------------------------------------------
     SUBMIT
     1. PATCH risk assessment (impatto / probabilità / rischio)
     2. PATCH ogni record M2M con u_Risultato selezionato
     Le due operazioni avvengono in parallelo con Promise.all
  ---------------------------------------------------------- */
  window.submitForm = function () {
    var errors = validate();
    if (errors.length) {
      showToast('error', errors[0]);
      return;
    }

    /* --- Payload risk assessment --- */
    var raPayload = {};
    var impatto = document.getElementById('impatto_inerente').value;
    if (impatto) raPayload.u_impatto_inerente231 = impatto;
    var prob = document.getElementById('probabilita_inerente').value;
    if (prob) raPayload.u_probabilita_inerente231 = prob;
    var rischio = document.getElementById('rischio_inerente').value;
    if (rischio) raPayload.u_rischio_inerente = rischio;

    /* --- Payload M2M: un PATCH per ogni riga --- */
    var rows = document.querySelectorAll('.ra-control-row[data-m2m-sys-id]');
    var m2mPatches = [];
    rows.forEach(function (row) {
      var m2mId  = row.dataset.m2mSysId;
      var val    = row.querySelector('.ra-risultato-select').value;
      var patch  = {};
      patch[M2M_RESULT_FIELD] = val;
      m2mPatches.push(
        callApi('PATCH', '/api/now/table/' + M2M_TABLE + '/' + m2mId, patch)
      );
    });

    setFormBusy(true);
    showToast('info', 'Salvataggio in corso…');

    var allCalls = [
      callApi('PATCH', '/api/now/table/' + RA_TABLE + '/' + _sysId, raPayload)
    ].concat(m2mPatches);

    Promise.all(allCalls)
      .then(function () {
        setFormBusy(false);
        showToast('success', 'Record aggiornato con successo!');
        /* Ricarica per aggiornare lo snapshot */
        loadAll();
      })
      .catch(function (err) {
        setFormBusy(false);
        showToast('error', 'Errore durante il salvataggio: ' + err.message);
      });
  };

  /* ----------------------------------------------------------
     ANNULLA MODIFICHE — ripristina snapshot
  ---------------------------------------------------------- */
  window.reloadRecord = function () {
    if (_raSnapshot) {
      populateRischioFields(_raSnapshot);
      renderControls(_m2mRecords);
      showToast('info', 'Modifiche annullate.');
    } else {
      loadAll();
    }
  };

  /* ----------------------------------------------------------
     UI HELPERS
  ---------------------------------------------------------- */
  function setSelectValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value || '';
    if (el.value !== (value || '')) el.value = '';
  }

  function showLoading(visible) {
    document.getElementById('ra-loading').style.display = visible ? 'flex' : 'none';
    document.getElementById('ra-main').style.display    = visible ? 'none' : 'block';
  }

  function showFatalError(msg) {
    var overlay = document.getElementById('ra-loading');
    overlay.innerHTML =
      '<div class="ra-loading-box ra-error-box">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40">' +
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
        '</svg>' +
        '<p>' + escapeHtml(msg) + '</p>' +
      '</div>';
    overlay.style.display = 'flex';
  }

  function setFormBusy(busy) {
    document.querySelectorAll('.ra-btn').forEach(function (btn) { btn.disabled = busy; });
  }

  function showToast(type, message) {
    var toast = document.getElementById('ra-toast');
    var icons = {
      success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      info:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    toast.className = 'ra-toast show ' + type;
    toast.innerHTML = (icons[type] || icons.info) + '<span>' + escapeHtml(message) + '</span>';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toast.className = 'ra-toast'; }, 4000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     INIT
  ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    _sysId = getSysId();

    if (!_sysId) {
      showFatalError('sys_id non trovato. Apri questa pagina con ?sys_id=<valore>');
      return;
    }

    document.getElementById('impatto_inerente').addEventListener('change', updateRischioDisplay);
    document.getElementById('probabilita_inerente').addEventListener('change', updateRischioDisplay);

    loadAll();
  });

})();
