class TermogeaZoneGridCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._instanceId = Math.random().toString(36).slice(2);
    this._refreshTimeouts = [];
    this._refreshIntervalHandle = null;
    this._onCrossCardRefresh = (event) => this._handleCrossCardRefresh(event);
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
  }

  connectedCallback() {
    window.addEventListener("termogea-zone-grid-refresh", this._onCrossCardRefresh);
    this._startPeriodicRefresh();
  }

  disconnectedCallback() {
    window.removeEventListener("termogea-zone-grid-refresh", this._onCrossCardRefresh);
    this._clearScheduledRefreshes();
    this._stopPeriodicRefresh();
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    if (config && typeof config !== "object") {
      throw new Error("Invalid configuration");
    }
    this._config = config || {};
    this._startPeriodicRefresh();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const entities = this._getEntities();
    return Math.max(2, Math.ceil(entities.length / 2));
  }

  getGridOptions() {
    return {
      columns: 6,
      rows: 4,
      min_rows: 3,
      min_columns: 3,
    };
  }

  _isTermogeaClimate(entityId, stateObj) {
    if (!entityId.startsWith("climate.")) {
      return false;
    }
    if (entityId.startsWith("climate.termogea_")) {
      return true;
    }
    const attrs = stateObj?.attributes || {};
    return typeof attrs.zone_id === "string" && attrs.zone_id.length > 0;
  }

  _getEntities() {
    if (!this._hass || !this._hass.states || typeof this._hass.states !== "object") {
      return [];
    }

    const configured = this._config.entities;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured
        .map((entry) => {
          if (typeof entry === "string") {
            return { entity: entry };
          }
          return entry;
        })
        .filter((entry) => typeof entry?.entity === "string");
    }

    const allClimate = Object.entries(this._hass.states).filter(([entityId]) =>
      entityId.startsWith("climate.")
    );
    const termogeaClimate = allClimate.filter(([entityId, stateObj]) =>
      this._isTermogeaClimate(entityId, stateObj)
    );
    const selected = termogeaClimate.length > 0 ? termogeaClimate : allClimate;

    return selected
      .sort((a, b) => {
        const aName = a[1]?.attributes?.friendly_name || a[0];
        const bName = b[1]?.attributes?.friendly_name || b[0];
        return String(aName).localeCompare(String(bName), undefined, { sensitivity: "base" });
      })
      .map(([entityId]) => ({ entity: entityId }));
  }

  _resolveGlobalPowerEntity() {
    if (!this._hass?.states) {
      return null;
    }
    const configured = this._config.global_power_entity;
    if (typeof configured === "string" && configured && this._hass.states[configured]) {
      return configured;
    }

    const switches = Object.keys(this._hass.states).filter((entityId) =>
      entityId.startsWith("switch.")
    );
    for (const entityId of switches) {
      const stateObj = this._hass.states[entityId];
      const friendly = String(stateObj?.attributes?.friendly_name || "").toLowerCase();
      if (friendly.includes("termogea") && friendly.includes("power")) {
        return entityId;
      }
    }
    for (const entityId of switches) {
      const lowered = entityId.toLowerCase();
      if (lowered.includes("termogea") && lowered.includes("global_power")) {
        return entityId;
      }
    }
    return null;
  }

  _resolveActiveSeason() {
    if (!this._hass?.states) {
      return null;
    }
    const configured = this._config.active_season_entity;
    if (typeof configured === "string" && configured && this._hass.states[configured]) {
      const state = String(this._hass.states[configured]?.state || "").trim().toLowerCase();
      return state || null;
    }

    const sensors = Object.keys(this._hass.states).filter((entityId) =>
      entityId.startsWith("sensor.")
    );
    for (const entityId of sensors) {
      const stateObj = this._hass.states[entityId];
      const friendly = String(stateObj?.attributes?.friendly_name || "").toLowerCase();
      if (friendly.includes("termogea") && friendly.includes("active season")) {
        const state = String(stateObj?.state || "").trim().toLowerCase();
        return state || null;
      }
    }
    for (const entityId of sensors) {
      const lowered = entityId.toLowerCase();
      if (lowered.includes("termogea") && lowered.includes("active_season")) {
        const state = String(this._hass.states[entityId]?.state || "").trim().toLowerCase();
        return state || null;
      }
    }
    return null;
  }

  _nameFor(entry, stateObj) {
    if (entry.name) {
      return entry.name;
    }
    if (stateObj?.attributes?.friendly_name) {
      return stateObj.attributes.friendly_name;
    }
    return entry.entity;
  }

  _isOn(stateObj) {
    const mode = stateObj?.state;
    return mode && mode !== "off" && mode !== "unavailable" && mode !== "unknown";
  }

  _isZoneDemanding(stateObj, activeSeason) {
    // "Attiva" = la zona sta effettivamente condizionando, non solo accesa.
    // 1) se il server segnala la domanda attiva (heating_active), fidati.
    if (this._toBoolean(stateObj?.attributes?.heating_active)) {
      return true;
    }
    // 2) fallback robusto indipendente dallo StatusBits della centralina
    //    (che in estate non riflette la domanda di raffrescamento): confronta
    //    temperatura corrente e target in base alla stagione.
    //    Estate: attiva se sopra il target. Inverno: attiva se sotto il target.
    const at = stateObj?.attributes || {};
    const current = Number(at.current_temperature);
    const target = Number(at.temperature);
    if (!Number.isFinite(current) || !Number.isFinite(target)) {
      return false;
    }
    const DELTA = 0.1;
    return activeSeason === "summer"
      ? current > target + DELTA
      : current < target - DELTA;
  }

  _hvacModes(stateObj) {
    const raw = stateObj?.attributes?.hvac_modes;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => String(item).toLowerCase())
      .filter((item) => item.length > 0);
  }

  _supportsHvacMode(stateObj, mode) {
    return this._hvacModes(stateObj).includes(String(mode).toLowerCase());
  }

  _requestEntityRefresh(entityIds) {
    if (!this._hass || !Array.isArray(entityIds) || entityIds.length === 0) {
      return;
    }
    this._hass.callService("homeassistant", "update_entity", {
      entity_id: entityIds,
    });
  }

  _entityIdsForCard() {
    const climateIds = this._getEntities().map((entry) => entry.entity);
    const globalPowerEntity = this._resolveGlobalPowerEntity();
    const zoneIds = new Set();
    for (const entityId of climateIds) {
      const attrs = this._hass?.states?.[entityId]?.attributes || {};
      const zoneId = String(attrs.zone_id || "").trim();
      if (zoneId) {
        zoneIds.add(zoneId.toLowerCase());
      }
    }

    const relatedSensorIds = [];
    if (this._hass?.states) {
      for (const [entityId, stateObj] of Object.entries(this._hass.states)) {
        if (!entityId.startsWith("sensor.") && !entityId.startsWith("binary_sensor.")) {
          continue;
        }
        const attrs = stateObj?.attributes || {};
        const zoneId = String(attrs.zone_id || "").trim().toLowerCase();
        if (zoneId && zoneIds.has(zoneId)) {
          relatedSensorIds.push(entityId);
        }
      }
    }

    const all = [...climateIds, ...relatedSensorIds];
    if (globalPowerEntity) {
      all.push(globalPowerEntity);
    }
    return Array.from(new Set(all));
  }

  _clearScheduledRefreshes() {
    for (const handle of this._refreshTimeouts) {
      clearTimeout(handle);
    }
    this._refreshTimeouts = [];
  }

  _startPeriodicRefresh() {
    this._stopPeriodicRefresh();
    const seconds = Number(this._config.refresh_interval_seconds ?? 20);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }
    this._refreshIntervalHandle = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      const entities = this._entityIdsForCard();
      this._requestEntityRefresh(entities);
    }, Math.max(5, seconds) * 1000);
  }

  _stopPeriodicRefresh() {
    if (this._refreshIntervalHandle !== null) {
      clearInterval(this._refreshIntervalHandle);
      this._refreshIntervalHandle = null;
    }
  }

  _broadcastCrossCardRefresh(entityIds) {
    window.dispatchEvent(
      new CustomEvent("termogea-zone-grid-refresh", {
        detail: {
          source: this._instanceId,
          entity_ids: entityIds,
        },
      })
    );
  }

  _handleCrossCardRefresh(event) {
    const detail = event?.detail || {};
    if (detail.source === this._instanceId) {
      return;
    }
    const entityIds = Array.isArray(detail.entity_ids) && detail.entity_ids.length > 0
      ? detail.entity_ids
      : this._entityIdsForCard();
    this._requestEntityRefresh(entityIds);
    this._render();
  }

  _schedulePostActionRefresh(entityIds) {
    this._requestEntityRefresh(entityIds);
    this._clearScheduledRefreshes();
    const delays = [
      Number(this._config.refresh_delay_ms ?? 1200),
      Number(this._config.refresh_delay2_ms ?? 3500),
    ].filter((value) => Number.isFinite(value) && value > 0);
    for (const delay of delays) {
      const handle = window.setTimeout(() => {
        this._requestEntityRefresh(entityIds);
        this._refreshTimeouts = this._refreshTimeouts.filter((item) => item !== handle);
      }, delay);
      this._refreshTimeouts.push(handle);
    }
    this._broadcastCrossCardRefresh(entityIds);
  }

  _toNumberOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  _toBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === null || value === undefined) {
      return false;
    }
    const normalized = String(value).trim().toLowerCase();
    return ["1", "true", "on", "yes", "home", "detected", "occupied"].includes(normalized);
  }

  _findZoneHumidityFromSensor(zoneId) {
    if (!zoneId || !this._hass?.states) {
      return null;
    }
    for (const [entityId, stateObj] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith("sensor.")) {
        continue;
      }
      const attrs = stateObj?.attributes || {};
      const sameZone = String(attrs.zone_id || "").toLowerCase() === String(zoneId).toLowerCase();
      if (!sameZone) {
        continue;
      }
      const deviceClass = String(attrs.device_class || "").toLowerCase();
      if (deviceClass !== "humidity") {
        continue;
      }
      if (stateObj.state === "unknown" || stateObj.state === "unavailable") {
        continue;
      }
      return this._toNumberOrNull(stateObj.state);
    }
    return null;
  }

  _resolveHumidity(stateObj) {
    const direct = this._toNumberOrNull(stateObj?.attributes?.current_humidity);
    const value = direct !== null
      ? direct
      : this._findZoneHumidityFromSensor(stateObj?.attributes?.zone_id);
    if (value === null) {
      return null;
    }
    if (value < 0 || value > 100) {
      return null;
    }
    return value;
  }

  _formatTemp(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
      return "--";
    }
    return Number(value).toFixed(1);
  }

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    try {
      if (!this._hass || !this._hass.states || typeof this._hass.states !== "object") {
        this.shadowRoot.innerHTML = "<ha-card><div class='empty'>Anteprima scheda Termogea.</div></ha-card>";
        return;
      }

      const title = this._config.title || "Termogea";
      const titleIcon = this._config.title_icon || "mdi:air-conditioner";
      const globalPowerEntity = this._resolveGlobalPowerEntity();
      const globalPowerState = globalPowerEntity ? this._hass.states[globalPowerEntity] : null;
      const globalPowerOn = globalPowerState?.state === "on";
      const activeSeason = this._resolveActiveSeason();
      const globalPowerButton = globalPowerEntity
        ? `<button class="global-power ${globalPowerOn ? "on" : "off"}"
              data-action="global_power_toggle"
              data-entity="${globalPowerEntity}"
              title="${globalPowerOn ? "Spegni tutto" : "Accendi tutto"}">
             ${globalPowerOn ? "Spegni tutto" : "Accendi tutto"}
           </button>`
        : "";
      const entities = this._getEntities();
      const cards = entities
        .map((entry) => {
          const stateObj = this._hass.states[entry.entity];
          const name = this._nameFor(entry, stateObj);
          const current = stateObj?.attributes?.current_temperature;
          const humidity = this._resolveHumidity(stateObj);
          const target = stateObj?.attributes?.temperature;
          const humidityPart =
            humidity === null
              ? ""
              : ` · UR ${this._formatTemp(humidity)}%`;
          const hasServerHeatingState = stateObj?.attributes?.heating_active !== undefined;
          const isOn = hasServerHeatingState
            ? this._toBoolean(stateObj?.attributes?.heating_active)
            : this._isOn(stateObj);
          const zoneId = String(stateObj?.attributes?.zone_id || "").trim();
          const configuredEnabled = this._toBoolean(
            stateObj?.attributes?.enabled ?? stateObj?.attributes?.zone_enabled
          );
          const zoneEnabled = this._toBoolean(stateObj?.attributes?.zone_enabled);
          const presenceDetected = this._toBoolean(stateObj?.attributes?.presence_detected);
          const unavailable = !stateObj || stateObj.state === "unavailable";
          const toggleDisabled = unavailable || !zoneId;
          const toggleLabel = configuredEnabled ? "ON" : "OFF";
          const zoneDemandActive = zoneEnabled && this._isZoneDemanding(stateObj, activeSeason);
          const demandIcon = activeSeason === "summer" ? "mdi:snowflake" : "mdi:fire";
          const presenceBadge = presenceDetected
            ? `<span class="zone-badge presence" title="Presenza rilevata"><ha-icon icon="mdi:account"></ha-icon></span>`
            : "";
          const operationBadge = zoneDemandActive
            ? `<span class="zone-badge operation" title="${activeSeason === "summer" ? "Raffrescamento attivo" : "Riscaldamento attivo"}"><ha-icon icon="${demandIcon}"></ha-icon></span>`
            : "";

          const toggleControl = `<button class="action toggle ${configuredEnabled ? "active" : ""}" data-action="toggle" data-entity="${entry.entity}" data-zone-id="${zoneId}" data-zone-enabled="${configuredEnabled}" title="${configuredEnabled ? "Disabilita zona (temperatura sicurezza)" : "Abilita zona"}" ${toggleDisabled ? "disabled" : ""}>
                  ${toggleLabel}
                </button>`;

          return `
            <div class="zone ${isOn ? "on" : "off"} ${configuredEnabled ? "" : "zone-disabled"} ${activeSeason === "summer" ? "season-summer" : ""} ${unavailable ? "unavailable" : ""}" data-action="more_info" data-entity="${entry.entity}" tabindex="0" role="button">
              <div class="zone-head">
                <div class="zone-name">${name}</div>
                <div class="zone-badges">${operationBadge}${presenceBadge}</div>
              </div>
              <div class="zone-temp">${this._formatTemp(current)}<span class="unit">°C</span></div>
              <div class="zone-target">Target ${this._formatTemp(target)}°C${humidityPart}</div>
              <div class="zone-actions">
                <button class="action small" data-action="temp_down" data-entity="${entry.entity}" ${unavailable ? "disabled" : ""}>-</button>
                <button class="action small" data-action="temp_up" data-entity="${entry.entity}" ${unavailable ? "disabled" : ""}>+</button>
                ${toggleControl}
              </div>
            </div>
          `;
        })
        .join("");

      this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }
        ha-card {
          overflow: hidden;
          padding: 16px;
        }
        .header {
          align-items: center;
          display: flex;
          gap: 8px;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .header-main {
          align-items: center;
          display: flex;
          gap: 8px;
          min-width: 0;
        }
        .header-icon {
          align-items: center;
          background: linear-gradient(165deg, #f4a000 0%, #f15a24 85%);
          border-radius: 50%;
          color: white;
          display: inline-flex;
          height: 28px;
          justify-content: center;
          width: 28px;
        }
        .header-icon ha-icon {
          --mdc-icon-size: 18px;
        }
        .title {
          font-size: 20px;
          font-weight: 600;
        }
        .global-power {
          background: #ffffff;
          border: 0;
          border-radius: 999px;
          color: #24415a;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          padding: 8px 12px;
          white-space: nowrap;
        }
        .global-power.on {
          background: #16a085;
          color: #ffffff;
        }
        .global-power.off {
          background: #e74c3c;
          color: #ffffff;
        }
        .grid {
          display: grid;
          gap: 12px;
          grid-template-columns: minmax(0, 1fr) !important;
          min-width: 0;
          width: 100%;
        }
        .zone {
          border: none;
          border-radius: 14px;
          color: white;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 150px;
          padding: 14px;
          overflow: hidden;
          position: relative;
          text-align: left;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          background: linear-gradient(165deg, #f4a000 0%, #f15a24 85%);
          transition: transform 120ms ease, filter 120ms ease;
        }
        .zone.season-summer {
          background: linear-gradient(165deg, #5bb8e8 0%, #2b7fc0 85%);
        }
        .zone.zone-disabled {
          background: linear-gradient(165deg, #6b7280 0%, #374151 85%);
        }
        .zone.unavailable {
          filter: grayscale(1);
          opacity: 0.7;
        }
        .zone:hover {
          transform: translateY(-1px);
        }
        .zone-name {
          flex: 1;
          font-size: 20px;
          font-weight: 500;
          line-height: 1.1;
          min-width: 0;
          text-transform: uppercase;
        }
        .zone-head {
          align-items: flex-start;
          display: flex;
          gap: 8px;
          justify-content: space-between;
          min-width: 0;
        }
        .zone-badges {
          display: flex;
          flex-shrink: 0;
          gap: 6px;
        }
        .zone-badge {
          align-items: center;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 999px;
          color: rgba(255, 255, 255, 0.95);
          display: inline-flex;
          height: 30px;
          justify-content: center;
          width: 30px;
        }
        .zone-badge ha-icon {
          --mdc-icon-size: 18px;
        }
        .zone-badge.presence {
          background: rgba(255, 255, 255, 0.24);
        }
        .zone-badge.operation {
          background: rgba(255, 255, 255, 0.24);
        }
        .zone-temp {
          font-size: 52px;
          font-weight: 700;
          line-height: 1;
        }
        .zone-temp .unit {
          font-size: 22px;
          font-weight: 600;
          margin-left: 2px;
        }
        .zone-target {
          font-size: 15px;
          opacity: 0.95;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .zone-actions {
          align-items: center;
          display: flex;
          gap: 8px;
          min-width: 0;
          width: 100%;
          margin-top: auto;
          flex-wrap: nowrap;
        }
        .action {
          -webkit-tap-highlight-color: transparent;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          padding: 6px 11px;
          touch-action: manipulation;
        }
        .action.small {
          background: rgba(255, 255, 255, 0.95);
          color: #333;
          width: 34px;
        }
        .action.toggle {
          background: rgba(255, 255, 255, 0.95);
          color: #666;
          margin-left: auto;
          min-width: 58px;
          flex-shrink: 0;
        }
        .action.toggle.active {
          color: #d9412e;
        }
        .action:disabled {
          cursor: default;
          opacity: 0.6;
        }
        .empty {
          color: var(--secondary-text-color);
          padding: 10px 0 6px;
        }
      </style>
      <ha-card>
        <div class="header">
          <div class="header-main">
            <span class="header-icon"><ha-icon icon="${titleIcon}"></ha-icon></span>
            <div class="title">${title}</div>
          </div>
          ${globalPowerButton}
        </div>
        <div class="grid">
          ${cards || "<div class='empty'>Nessuna zona Termogea trovata.</div>"}
        </div>
      </ha-card>
    `;
    } catch (err) {
      console.error("Termogea zone grid card render error", err);
      this.shadowRoot.innerHTML =
        "<ha-card><div class='empty'>Errore caricamento scheda Termogea. Controlla la console browser.</div></ha-card>";
    }
  }

  _fireEvent(type, detail = {}) {
    this.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        composed: true,
        detail,
      })
    );
  }

  _onClick(event) {
    const composedTarget = event.composedPath?.()[0] ?? event.target;
    const targetElement =
      composedTarget instanceof Element ? composedTarget : composedTarget?.parentElement;
    const actionElement = targetElement?.closest?.("[data-action]");
    if (!actionElement || !this._hass) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();

    const entityId = actionElement.getAttribute("data-entity");
    const action = actionElement.getAttribute("data-action");
    if (!entityId || !action) {
      return;
    }

    if (action === "more_info") {
      this._fireEvent("hass-more-info", { entityId });
      return;
    }

    const stateObj = this._hass.states[entityId];
    if (!stateObj || stateObj.state === "unavailable") {
      return;
    }

    if (actionElement.hasAttribute("disabled")) {
      return;
    }

    if (action === "toggle") {
      const fallbackHvacToggle = () => {
        const isOn = this._isOn(stateObj);
        const supportsOff = this._supportsHvacMode(stateObj, "off");
        const supportsHeat = this._supportsHvacMode(stateObj, "heat");
        const mode = isOn
          ? "off"
          : supportsHeat
            ? "heat"
            : this._hvacModes(stateObj).find((item) => item !== "off");
        if (!mode || (mode === "off" && !supportsOff)) {
          return Promise.resolve();
        }
        return Promise.resolve(
          this._hass.callService("climate", "set_hvac_mode", {
            entity_id: entityId,
            hvac_mode: mode,
          })
        )
          .then(() => this._schedulePostActionRefresh(this._entityIdsForCard()))
          .catch((err) => console.error("Termogea HVAC toggle fallback failed", err));
      };

      const zoneId = String(
        actionElement.getAttribute("data-zone-id") || stateObj?.attributes?.zone_id || ""
      ).trim();
      const enabledFromButton = actionElement.getAttribute("data-zone-enabled");
      const currentlyEnabled =
        enabledFromButton === null
          ? this._toBoolean(stateObj?.attributes?.enabled ?? stateObj?.attributes?.zone_enabled)
          : this._toBoolean(enabledFromButton);

      if (zoneId) {
        Promise.resolve(
          this._hass.callService("termogea", "set_zone_enabled", {
            zone_id: zoneId,
            enabled: !currentlyEnabled,
          })
        )
          .then(() => this._schedulePostActionRefresh(this._entityIdsForCard()))
          .catch((err) => {
            console.error("Termogea zone enabled toggle failed", err);
            return fallbackHvacToggle();
          });
        return;
      }
      fallbackHvacToggle();
      return;
    }

    if (action === "global_power_toggle") {
      const turnOn = stateObj.state !== "on";
      Promise.resolve(
        this._hass.callService("switch", turnOn ? "turn_on" : "turn_off", {
          entity_id: entityId,
        })
      )
        .then(() => this._schedulePostActionRefresh(this._entityIdsForCard()))
        .catch((err) => console.error("Termogea global power toggle failed", err));
      return;
    }

    if (action === "temp_up" || action === "temp_down") {
      const current = Number(stateObj.attributes.temperature ?? stateObj.attributes.current_temperature);
      const min = Number(stateObj.attributes.min_temp ?? 5);
      const max = Number(stateObj.attributes.max_temp ?? 35);
      const step = Number(
        this._config.temperature_step
          ?? stateObj.attributes.target_temp_step
          ?? stateObj.attributes.temperature_step
          ?? 0.5
      );
      if (Number.isNaN(current) || Number.isNaN(step)) {
        return;
      }
      const direction = action === "temp_up" ? 1 : -1;
      const next = Math.min(max, Math.max(min, current + direction * step));
      Promise.resolve(
        this._hass.callService("climate", "set_temperature", {
          entity_id: entityId,
          temperature: Number(next.toFixed(1)),
        })
      )
        .then(() => this._schedulePostActionRefresh(this._entityIdsForCard()))
        .catch((err) => console.error("Termogea set_temperature failed", err));
    }
  }
}

const TERMOGEA_CARD_TYPE = "termogea-zone-grid-card";
const TERMOGEA_CARD_TYPE_V2 = "termogea-zone-grid-card-v2";
const TERMOGEA_CARD_TYPE_V3 = "termogea-zone-grid-card-v3";

// Definisce tutti e tre gli alias per retrocompatibilita con dashboard esistenti.
// Solo il tipo principale viene registrato nel picker della UI.
const defineCard = (tag) => {
  if (!customElements.get(tag)) {
    customElements.define(tag, class extends TermogeaZoneGridCard {});
  }
};

defineCard(TERMOGEA_CARD_TYPE);
defineCard(TERMOGEA_CARD_TYPE_V2);
defineCard(TERMOGEA_CARD_TYPE_V3);

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card && (card.type === TERMOGEA_CARD_TYPE || card.type === `custom:${TERMOGEA_CARD_TYPE}`))) {
  window.customCards.push({
    type: TERMOGEA_CARD_TYPE,
    name: "Termogea Zone Grid",
    description: "Griglia rapida delle zone Termogea con toggle, setpoint e umidita.",
    preview: true,
    documentationURL: "https://github.com/Cobracco/home-assistant-termogea-card",
  });
}
