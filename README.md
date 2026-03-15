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
global_power_entity: switch.termogea_power
```

Se hai problemi di cache risorse, usa la variante:

```yaml
type: custom:termogea-zone-grid-card-v2
title: Termogea
title_icon: mdi:air-conditioner
```

Se la plancia mostra ancora codice vecchio, usa la variante v3:

```yaml
type: custom:termogea-zone-grid-card-v3
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
- `global_power_entity` (opzionale): switch master ON/OFF globale mostrato in alto sulla card.
- Se non specifichi `entities`, la card rileva automaticamente le climate Termogea:
  - prefisso `climate.termogea_*`
  - oppure attributo `zone_id` presente (compatibile con entity_id rinominati, es. `climate.hobby`)
- Se nessuna climate Termogea viene rilevata, fallback automatico su tutte le `climate.*`.
- L'umidita viene mostrata se disponibile nell'attributo `current_humidity` della climate.
- Se `current_humidity` non e valorizzato sulla climate, la card prova fallback sul sensore umidita della stessa `zone_id`.
- Se una zona non ha umidita disponibile, la card non mostra il campo `UR`.
- Colore tile:
  - arancione base
  - verde quando la policy zona e abilitata e `presence_detected` e attivo
- Quando `presence_detected` e attivo, compare una icona persona sulla card zona.
- Il toggle ON/OFF usa solo modalita HVAC realmente supportate dalla zona.
- Se non vedi aggiornamenti, controlla in **Impostazioni -> Dashboard -> Risorse** che non ci siano duplicati tra `/local/...` e `/hacsfiles/home-assistant-termogea-card/...`.
