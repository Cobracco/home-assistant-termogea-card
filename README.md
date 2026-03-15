# Termogea Zone Grid Card

Custom card Lovelace per Home Assistant dedicata a Termogea.

## Funzionalita

- griglia zone con stile Termogea
- temperatura corrente e target
- umidita (se esposta negli attributi climate)
- toggle rapido ON/OFF
- aumento/diminuzione setpoint
- apertura `more-info` al tap sulla tile

## Installazione con HACS

1. Vai in **HACS -> Frontend -> Menu (⋮) -> Custom repositories**.
2. Aggiungi questa repository con categoria **Dashboard**:
   - `https://github.com/Cobracco/home-assistant-termogea-card`
3. Installa **Termogea Zone Grid Card**.
4. Riavvia Home Assistant.
5. Fai hard refresh del browser (`Ctrl/Cmd+Shift+R`).

## Configurazione Lovelace

```yaml
type: custom:termogea-zone-grid-card
title: Termogea
title_icon: mdi:air-conditioner
```

Con entita esplicite:

```yaml
type: custom:termogea-zone-grid-card
title: Zone piano terra
entities:
  - entity: climate.termogea_zona_1_climate
    name: Hobby
  - entity: climate.termogea_zona_2_climate
```

## Note

- Se non specifichi `entities`, la card prende automaticamente tutte le entita `climate.termogea_*`.
- Se non specifichi `entities`, la card rileva automaticamente le climate Termogea:
  - prefisso `climate.termogea_*`
  - oppure attributo `zone_id` presente (compatibile con entity_id rinominati, es. `climate.hobby`)
- L'umidita viene mostrata se disponibile nell'attributo `current_humidity` della climate.
