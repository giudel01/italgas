/* ============================================================
   RISK ASSESSMENT — ServiceNow UI Page JavaScript
   Aggiorna un record esistente di u_risk_assessment_custom
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     COSTANTI
  ---------------------------------------------------------- */
  var TABLE_NAME = 'u_risk_assessment_custom';

  /* Matrice di calcolo Rischio Inerente
     RISK_MATRIX[probabilita][impatto] → livello rischio */
  var RISK_MATRIX = {
    alto:  { alto: 'alto',  medio: 'alto',  basso: 'medio' },
    medio: { alto: 'alto',  medio: 'medio', basso: 'basso' },
    basso: { alto: 'medio', medio: 'basso', basso: 'basso' }
  };

  /* Snapshot dei valori caricati dal server (per "annulla modifiche") */
  var _originalData = null;

  /* sys_id del record corrente */
  var _sysId = null;

  /* ----------------------------------------------------------
     UTILITY: lettura sys_id dall'URL o dal campo hidden Jelly
  ---------------------------------------------------------- */
  function getSysId() {
    /* 1. campo hidden iniettato da Jelly ${sysparm_sys_id} */
    var el = document.getElementById('ra_sys_id');
    if (el && el.value && el.value.trim() !== '' && el.value !== '${sysparm_sys_id}') {
      return el.value.trim();
    }
    /* 2. fallback: parametro URL ?sys_id=... o ?sysparm_sys_id=... */
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
      /* CSRF token ServiceNow (disponibile nel contesto UI Page) */
      if (window.g_ck) {
        xhr.setRequestHeader('X-UserToken', window.g_ck);
      }

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (_) { resolve({}); }
        } else {
          var msg = 'Errore HTTP ' + xhr.status;
          try {
            var body = JSON.parse(xhr.responseText);
            if (body && body.error && body.error.message) msg = body.error.message;
          } catch (_) {}
          reject(new Error(msg));
        }
      };

      xhr.onerror = function () { reject(new Error('Errore di rete')); };
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  /* ----------------------------------------------------------
     CARICAMENTO RECORD
  ---------------------------------------------------------- */
  function loadRecord() {
    showLoading(true);

    var fields = [
      'sys_id',
      'u_impatto_inerente231',
      'u_probabilita_inerente231',
      'u_rischio_inerente',
      'u_c1', 'u_valutazione_c1',
      'u_c2', 'u_valutazione_c2',
      'u_c3', 'u_valutazione_c3',
      'u_c4', 'u_valutazione_c4'
    ].join(',');

    var url = '/api/now/table/' + TABLE_NAME + '/' + _sysId
      + '?sysparm_display_value=all'
      + '&sysparm_fields=' + fields;

    callApi('GET', url)
      .then(function (data) {
        var rec = data.result;
        if (!rec) throw new Error('Record non trovato');
        _originalData = rec;
        populateForm(rec);
        showLoading(false);
      })
      .catch(function (err) {
        showLoading(false);
        showFatalError('Impossibile caricare il record: ' + err.message);
      });
  }

  /* ----------------------------------------------------------
     POPOLAMENTO FORM
     Con sysparm_display_value=all ogni campo ha la forma:
     { value: "...", display_value: "..." }
  ---------------------------------------------------------- */
  function populateForm(rec) {
    /* Helper per estrarre valore e display_value */
    function val(field) {
      var f = rec[field];
      if (!f) return { v: '', d: '' };
      if (typeof f === 'object') return { v: f.value || '', d: f.display_value || f.value || '' };
      return { v: f, d: f };
    }

    /* --- Rischio Inerente --- */
    var impatto     = val('u_impatto_inerente231');
    var probabilita = val('u_probabilita_inerente231');

    setSelectValue('impatto_inerente',     impatto.v);
    setSelectValue('probabilita_inerente', probabilita.v);
    updateRischioDisplay();

    /* --- Record label in header --- */
    var label = document.getElementById('ra-record-label');
    if (label) {
      label.textContent = 'Record: ' + _sysId;
    }

    /* --- Controlli --- */
    var controls = ['c1', 'c2', 'c3', 'c4'];
    var anyVisible = false;

    controls.forEach(function (cx) {
      var ctrlField = val('u_' + cx);
      var valField  = val('u_valutazione_' + cx);
      var row       = document.getElementById('row_' + cx);

      if (ctrlField.v) {
        /* Il controllo è precompilato: mostra la riga */
        document.getElementById(cx).value        = ctrlField.v;
        document.getElementById(cx + '_name').textContent = ctrlField.d || ctrlField.v;
        setSelectValue('valutazione_' + cx, valField.v);

        row.classList.remove('ra-hidden');
        anyVisible = true;
      } else {
        row.classList.add('ra-hidden');
      }
    });

    if (!anyVisible) {
      document.getElementById('ra-no-controls').classList.remove('ra-hidden');
    }
  }

  /* ----------------------------------------------------------
     CALCOLO RISCHIO INERENTE
  ---------------------------------------------------------- */
  function updateRischioDisplay() {
    var prob    = document.getElementById('probabilita_inerente').value;
    var impact  = document.getElementById('impatto_inerente').value;
    var risk    = (RISK_MATRIX[prob] && RISK_MATRIX[prob][impact]) ? RISK_MATRIX[prob][impact] : null;
    var display = document.getElementById('rischio_inerente_display');
    var hidden  = document.getElementById('rischio_inerente');

    var labels  = { alto: 'ALTO', medio: 'MEDIO', basso: 'BASSO' };

    display.innerHTML = '';
    display.className = 'ra-computed-field';
    hidden.value      = '';

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
     VALIDAZIONE
  ---------------------------------------------------------- */
  function validate() {
    var errors = [];

    /* Valutazioni obbligatorie solo per i controlli visibili */
    ['c1', 'c2', 'c3', 'c4'].forEach(function (cx) {
      var row = document.getElementById('row_' + cx);
      if (!row.classList.contains('ra-hidden')) {
        var sel = document.getElementById('valutazione_' + cx);
        if (!sel.value) {
          errors.push('Seleziona una valutazione per ' + cx.toUpperCase());
        }
      }
    });

    return errors;
  }

  /* ----------------------------------------------------------
     SUBMIT — PATCH record esistente
  ---------------------------------------------------------- */
  window.submitForm = function () {
    var errors = validate();
    if (errors.length) {
      showToast('error', errors[0]);
      return;
    }

    /* Costruisce il payload con i soli campi modificabili */
    var payload = {};

    var impatto = document.getElementById('impatto_inerente').value;
    if (impatto) payload.u_impatto_inerente231 = impatto;

    var prob = document.getElementById('probabilita_inerente').value;
    if (prob) payload.u_probabilita_inerente231 = prob;

    var rischio = document.getElementById('rischio_inerente').value;
    if (rischio) payload.u_rischio_inerente = rischio;

    /* Valutazioni dei controlli visibili */
    ['c1', 'c2', 'c3', 'c4'].forEach(function (cx) {
      var row = document.getElementById('row_' + cx);
      if (!row.classList.contains('ra-hidden')) {
        var v = document.getElementById('valutazione_' + cx).value;
        payload['u_valutazione_' + cx] = v;
      }
    });

    setFormBusy(true);
    showToast('info', 'Salvataggio in corso…');

    var url = '/api/now/table/' + TABLE_NAME + '/' + _sysId;

    callApi('PATCH', url, payload)
      .then(function () {
        setFormBusy(false);
        showToast('success', 'Record aggiornato con successo!');
        /* Aggiorna lo snapshot locale */
        loadRecord();
      })
      .catch(function (err) {
        setFormBusy(false);
        showToast('error', 'Errore durante il salvataggio: ' + err.message);
      });
  };

  /* ----------------------------------------------------------
     ANNULLA MODIFICHE — ricarica dal server
  ---------------------------------------------------------- */
  window.reloadRecord = function () {
    if (_originalData) {
      populateForm(_originalData);
      showToast('info', 'Modifiche annullate.');
    } else {
      loadRecord();
    }
  };

  /* ----------------------------------------------------------
     UI HELPERS
  ---------------------------------------------------------- */
  function setSelectValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value || '';
    /* Se il valore non esiste nelle opzioni, lascia vuoto */
    if (el.value !== (value || '')) el.value = '';
  }

  function showLoading(visible) {
    var overlay = document.getElementById('ra-loading');
    var main    = document.getElementById('ra-main');
    if (visible) {
      overlay.style.display = 'flex';
      main.style.display    = 'none';
    } else {
      overlay.style.display = 'none';
      main.style.display    = 'block';
    }
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
    document.querySelectorAll('.ra-btn').forEach(function (btn) {
      btn.disabled = busy;
    });
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
    toast._timer = setTimeout(function () {
      toast.className = 'ra-toast';
    }, 4000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     INIT
  ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    _sysId = getSysId();

    if (!_sysId) {
      showLoading(false);
      showFatalError('sys_id non trovato. Apri questa pagina con il parametro ?sys_id=<valore>');
      return;
    }

    /* Aggiorna rischio al cambio dei select */
    document.getElementById('impatto_inerente').addEventListener('change', updateRischioDisplay);
    document.getElementById('probabilita_inerente').addEventListener('change', updateRischioDisplay);

    /* Carica il record */
    loadRecord();
  });

})();
