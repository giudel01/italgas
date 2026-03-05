/* ============================================================
   RISK ASSESSMENT — ServiceNow UI Page JavaScript
   Table API: u_risk_assessment_custom
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     COSTANTI
  ---------------------------------------------------------- */
  var TABLE_NAME        = 'u_risk_assessment_custom';
  var SEARCH_TABLE      = 'u_controllo';          // tabella dei controlli — adattare se necessario
  var SEARCH_LABEL_FIELD = 'name';                // campo etichetta nella tabella controlli
  var SEARCH_LIMIT      = 20;

  /* Matrice di calcolo Rischio Inerente:
     righe = Probabilità, colonne = Impatto */
  var RISK_MATRIX = {
    alto:  { alto: 'alto',  medio: 'alto',  basso: 'medio' },
    medio: { alto: 'alto',  medio: 'medio', basso: 'basso' },
    basso: { alto: 'medio', medio: 'basso', basso: 'basso' }
  };

  var RISK_LABELS = {
    alto:  'ALTO',
    medio: 'MEDIO',
    basso: 'BASSO'
  };

  /* ----------------------------------------------------------
     STATO INTERNO
  ---------------------------------------------------------- */
  var _currentRefField   = null;   // id del campo hidden corrente
  var _currentDispField  = null;   // id del campo display corrente
  var _searchTimeout     = null;

  /* ----------------------------------------------------------
     UTILITY: API CALL
  ---------------------------------------------------------- */
  /**
   * Esegue una chiamata alle ServiceNow Table REST API.
   * @param {string} method   - GET | POST
   * @param {string} url      - URL relativo, es. /api/now/table/...
   * @param {object} [body]   - payload JSON per POST
   * @returns {Promise<object>}
   */
  function callApi(method, url, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-UserToken', window.g_ck || '');  // CSRF token ServiceNow

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve({});
          }
        } else {
          var errMsg = 'Errore HTTP ' + xhr.status;
          try {
            var errBody = JSON.parse(xhr.responseText);
            if (errBody && errBody.error && errBody.error.message) {
              errMsg = errBody.error.message;
            }
          } catch (_) {}
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = function () {
        reject(new Error('Errore di rete'));
      };

      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  /* ----------------------------------------------------------
     CALCOLO RISCHIO INERENTE
  ---------------------------------------------------------- */
  function computeRisk(probabilita, impatto) {
    if (!probabilita || !impatto) return null;
    var row = RISK_MATRIX[probabilita];
    return row ? (row[impatto] || null) : null;
  }

  function updateRischioDisplay() {
    var prob    = document.getElementById('probabilita_inerente').value;
    var impact  = document.getElementById('impatto_inerente').value;
    var risk    = computeRisk(prob, impact);
    var display = document.getElementById('rischio_inerente_display');
    var hidden  = document.getElementById('rischio_inerente');

    display.innerHTML  = '';
    display.className  = 'ra-computed-field';
    hidden.value       = '';

    if (risk) {
      display.classList.add(risk);
      hidden.value = risk;
      var span = document.createElement('span');
      span.className = 'ra-computed-text';
      span.textContent = RISK_LABELS[risk];
      display.appendChild(span);
    } else {
      var placeholder = document.createElement('span');
      placeholder.className = 'ra-computed-placeholder';
      placeholder.textContent = 'Calcolato automaticamente';
      display.appendChild(placeholder);
    }
  }

  function updateSelectBadge(selectId, badgeWrapperId) {
    var sel    = document.getElementById(selectId);
    var badge  = document.getElementById(badgeWrapperId);
    badge.innerHTML = '';

    var val = sel.value;
    if (!val) return;

    /* sposta il padding del select per non coprire il badge */
    // (gestito via CSS: il badge è posizionato assolutamente, non interferisce)
  }

  /* ----------------------------------------------------------
     RICERCA REFERENZA (MODALE)
  ---------------------------------------------------------- */
  window.openRefSearch = function (hiddenId, displayId) {
    _currentRefField  = hiddenId;
    _currentDispField = displayId;

    var overlay = document.getElementById('ra-modal-overlay');
    overlay.classList.add('open');

    var input = document.getElementById('modal-search-input');
    input.value = '';
    input.focus();

    var results = document.getElementById('modal-results');
    results.innerHTML = '<div class="ra-modal-empty">Inizia a digitare per cercare…</div>';
  };

  window.closeModal = function () {
    var overlay = document.getElementById('ra-modal-overlay');
    overlay.classList.remove('open');
    _currentRefField  = null;
    _currentDispField = null;
    clearTimeout(_searchTimeout);
  };

  window.searchRecords = function (query) {
    clearTimeout(_searchTimeout);

    var results = document.getElementById('modal-results');

    if (!query || query.trim().length < 2) {
      results.innerHTML = '<div class="ra-modal-empty">Inizia a digitare per cercare…</div>';
      return;
    }

    results.innerHTML = '<div class="ra-modal-loading"><div class="ra-spinner"></div> Ricerca in corso…</div>';

    _searchTimeout = setTimeout(function () {
      var url = '/api/now/table/' + SEARCH_TABLE
        + '?' + SEARCH_LABEL_FIELD + 'CONTAINS' + encodeURIComponent(query.trim())
        + '&sysparm_fields=sys_id,' + SEARCH_LABEL_FIELD
        + '&sysparm_limit=' + SEARCH_LIMIT
        + '&sysparm_query=active%3Dtrue^' + SEARCH_LABEL_FIELD + 'CONTAINS' + encodeURIComponent(query.trim());

      callApi('GET', url)
        .then(function (data) {
          renderModalResults(data.result || []);
        })
        .catch(function (err) {
          results.innerHTML = '<div class="ra-modal-empty">Errore durante la ricerca: ' + err.message + '</div>';
        });
    }, 350);
  };

  function renderModalResults(records) {
    var results = document.getElementById('modal-results');
    results.innerHTML = '';

    if (!records.length) {
      results.innerHTML = '<div class="ra-modal-empty">Nessun risultato trovato.</div>';
      return;
    }

    records.forEach(function (rec, idx) {
      var label = rec[SEARCH_LABEL_FIELD] || rec.sys_id;
      var sysId = rec.sys_id;

      var item = document.createElement('div');
      item.className = 'ra-modal-item';

      item.innerHTML =
        '<div class="ra-modal-item-icon">' + (idx + 1) + '</div>' +
        '<div>' +
          '<div class="ra-modal-item-label">' + escapeHtml(label) + '</div>' +
          '<div class="ra-modal-item-sub">' + escapeHtml(sysId) + '</div>' +
        '</div>';

      item.addEventListener('click', function () {
        selectRef(sysId, label);
      });

      results.appendChild(item);
    });
  }

  function selectRef(sysId, label) {
    if (_currentRefField) {
      document.getElementById(_currentRefField).value = sysId;
    }
    if (_currentDispField) {
      var dispInput = document.getElementById(_currentDispField);
      dispInput.value = label;
      dispInput.setAttribute('value', label); // per il selector CSS
    }
    closeModal();
  }

  window.clearRef = function (hiddenId, displayId) {
    document.getElementById(hiddenId).value  = '';
    var disp = document.getElementById(displayId);
    disp.value = '';
    disp.removeAttribute('value');
  };

  /* ----------------------------------------------------------
     VALIDAZIONE
  ---------------------------------------------------------- */
  function validate() {
    var errors = [];

    if (!document.getElementById('impatto_inerente').value) {
      errors.push('Impatto Inerente 231 è obbligatorio');
    }
    if (!document.getElementById('probabilita_inerente').value) {
      errors.push('Probabilità Inerente 231 è obbligatoria');
    }

    return errors;
  }

  /* ----------------------------------------------------------
     SUBMIT
  ---------------------------------------------------------- */
  window.submitForm = function () {
    var errors = validate();
    if (errors.length) {
      showToast('error', errors[0]);
      return;
    }

    var payload = {
      u_impatto_inerente231:     document.getElementById('impatto_inerente').value,
      u_probabilita_inerente231: document.getElementById('probabilita_inerente').value,
      u_rischio_inerente:        document.getElementById('rischio_inerente').value,
      u_c1:                      document.getElementById('c1').value,
      u_valutazione_c1:          document.getElementById('valutazione_c1').value,
      u_c2:                      document.getElementById('c2').value,
      u_valutazione_c2:          document.getElementById('valutazione_c2').value,
      u_c3:                      document.getElementById('c3').value,
      u_valutazione_c3:          document.getElementById('valutazione_c3').value,
      u_c4:                      document.getElementById('c4').value,
      u_valutazione_c4:          document.getElementById('valutazione_c4').value
    };

    /* Rimuove campi vuoti */
    Object.keys(payload).forEach(function (key) {
      if (!payload[key]) delete payload[key];
    });

    setFormBusy(true);
    showToast('info', 'Salvataggio in corso…');

    var url = '/api/now/table/' + TABLE_NAME;

    callApi('POST', url, payload)
      .then(function (data) {
        setFormBusy(false);
        var sysId = data.result && data.result.sys_id ? data.result.sys_id : '';
        showToast('success', 'Record salvato con successo!' + (sysId ? ' ID: ' + sysId : ''));
        resetForm();
      })
      .catch(function (err) {
        setFormBusy(false);
        showToast('error', 'Errore durante il salvataggio: ' + err.message);
      });
  };

  /* ----------------------------------------------------------
     RESET
  ---------------------------------------------------------- */
  window.resetForm = function () {
    ['impatto_inerente', 'probabilita_inerente'].forEach(function (id) {
      document.getElementById(id).value = '';
    });

    ['c1', 'c2', 'c3', 'c4'].forEach(function (id) {
      window.clearRef(id, id + '_display');
    });

    ['valutazione_c1', 'valutazione_c2', 'valutazione_c3', 'valutazione_c4'].forEach(function (id) {
      document.getElementById(id).value = '';
    });

    updateRischioDisplay();
    document.getElementById('badge_impatto').innerHTML     = '';
    document.getElementById('badge_probabilita').innerHTML = '';
  };

  /* ----------------------------------------------------------
     UI HELPERS
  ---------------------------------------------------------- */
  function setFormBusy(busy) {
    var btns = document.querySelectorAll('.ra-btn');
    btns.forEach(function (btn) { btn.disabled = busy; });
  }

  function showToast(type, message) {
    var toast = document.getElementById('ra-toast');
    var icon  = '';

    if (type === 'success') {
      icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (type === 'error') {
      icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
      icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.className  = 'ra-toast show ' + type;
    toast.innerHTML  = icon + '<span>' + escapeHtml(message) + '</span>';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.className = 'ra-toast';
    }, 4000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  /* ----------------------------------------------------------
     EVENT LISTENERS — inizializzazione
  ---------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {

    /* Calcola rischio inerente al cambio dei select */
    document.getElementById('impatto_inerente').addEventListener('change', function () {
      updateRischioDisplay();
      updateSelectBadge('impatto_inerente', 'badge_impatto');
    });

    document.getElementById('probabilita_inerente').addEventListener('change', function () {
      updateRischioDisplay();
      updateSelectBadge('probabilita_inerente', 'badge_probabilita');
    });

    /* Chiudi modale con Escape */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        window.closeModal();
      }
    });

    /* Ricerca nel modale con Invio */
    document.getElementById('modal-search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(_searchTimeout);
        window.searchRecords(this.value);
      }
    });
  });

})();
