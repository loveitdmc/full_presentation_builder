# Love IT DMC · Presenta — Setup Guide

App web per generare presentazioni da PDF. Accessibile da tutti, modificabile solo da Marco.

---

## Cosa serve (tutto gratuito)

| Cosa | Dove | Note |
|------|------|------|
| Account GitHub | github.com | Per tenere i file e fare aggiornamenti |
| Account Vercel | vercel.com | Per hostare l'app online |
| API Key Anthropic | console.anthropic.com | Per l'AI — ~€0.03 per presentazione |
| API Key Unsplash (opzionale) | unsplash.com/developers | Per le foto nelle slide · 50 req/ora gratis |

---

## Setup — passo per passo

### 1. Crea il repository su GitHub

1. Vai su **github.com** → clicca **New repository**
2. Nome: `loveit-presenta` (privato o pubblico, a scelta)
3. Trascina l'intera cartella `loveit-presenta-app/` nel repository (o usa GitHub Desktop)
4. Fai commit → Push

### 2. Collega Vercel a GitHub

1. Vai su **vercel.com** → Sign up con il tuo account GitHub
2. Clicca **Add New Project**
3. Importa il repository `loveit-presenta`
4. Vercel rileva automaticamente la configurazione — clicca **Deploy**

### 3. Aggiungi le variabili d'ambiente su Vercel

Nel progetto Vercel → **Settings → Environment Variables**, aggiungi:

| Nome variabile | Valore | Dove ottenerla |
|----------------|--------|----------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com → API Keys |
| `UNSPLASH_ACCESS_KEY` | `...` | unsplash.com/oauth/applications (opzionale) |

Dopo aver aggiunto le variabili → clicca **Redeploy**.

### 4. Ottieni la API Key Anthropic

1. Vai su **console.anthropic.com**
2. Registrati (oppure accedi se hai già un account)
3. Vai su **API Keys** → **Create Key**
4. Copia la chiave e incollala in Vercel come `ANTHROPIC_API_KEY`
5. Aggiungi un metodo di pagamento su Anthropic (pay-per-use)
   - Budget stimato: ~€0.03 per presentazione, ~€1-3/mese per uso normale

### 5. (Opzionale) Ottieni la API Key Unsplash

Senza questa chiave l'app usa foto di default incorporate.
Con la chiave: le foto vengono cercate per ogni attività (risultato molto migliore).

1. Vai su **unsplash.com/developers** → **Your apps** → **New Application**
2. Copia l'**Access Key** e incollala in Vercel come `UNSPLASH_ACCESS_KEY`

### 6. Condividi l'URL con il team

Vercel assegna un URL tipo `loveit-presenta.vercel.app`.
Puoi anche configurare un dominio personalizzato tipo `presenta.loveit-dmc.com`.

Condividi quell'URL con tutto il team — chiunque può usarlo senza installare nulla.

---

## Come aggiornare il template

Quando vuoi aggiornare il template di presentazione (nuovo layout, nuovi stili, ecc.):

1. Modifica `template/loveit_template.html` nel repository GitHub
2. Fai commit → Push
3. Vercel rideploya automaticamente in ~1 minuto
4. Tutti gli utenti vedono la versione aggiornata al prossimo utilizzo

---

## Come funziona l'app

```
Utente carica PDF
      ↓
App invia il PDF (base64) all'API /api/generate
      ↓
La funzione chiama Claude claude-sonnet-4-6 con il PDF
      ↓
Claude estrae: cliente, date, pax, attività, ecc.
      ↓
La funzione cerca le foto su Unsplash per ogni attività
      ↓
I dati vengono iniettati nel template HTML
      ↓
L'utente scarica il file .html e lo apre nel browser
```

---

## Struttura file

```
loveit-presenta-app/
├── public/
│   └── index.html           ← interfaccia web (frontend)
├── api/
│   └── generate.js          ← funzione serverless (backend)
├── template/
│   └── loveit_template.html ← template presentazione
├── package.json
├── vercel.json
└── SETUP.md                 ← questo file
```

---

## Aggiornare le istruzioni AI

Le istruzioni per l'AI si trovano nel file `api/generate.js`, nella costante `SYSTEM_PROMPT` in cima al file.
Puoi modificarla direttamente su GitHub → salva → Vercel rideploya automaticamente.

---

## Permessi Airtable per l'archivio presentazioni (§4.4)

Presenta **legge** dalla base *LoveIT Fornitori* e **scrive** una sola cosa, in
una sola tabella: `Presentations` nella base *Love IT Projects*
(`appdvIG3LsRARALRP`). Fino alla v57 non scriveva niente da nessuna parte, per
cui il token configurato ha accesso alla sola base Fornitori — e il salvataggio
risponde:

```
403 INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND
```

### Come sistemarlo

Su **airtable.com/create/tokens**, aprire il token usato da Presenta
(quello in `AIRTABLE_TOKEN` su Vercel) e:

1. in **Scopes**, verificare che ci sia `data.records:read` e aggiungere
   `data.records:write`;
2. in **Access**, aggiungere la base **Love IT Projects** accanto a LoveIT
   Fornitori;
3. salvare. Il valore del token **non cambia**: non serve rigenerarlo, né
   toccare Vercel, né ridistribuire. Basta riprovare il salvataggio.

### Variante più prudente (consigliata se il token è condiviso)

Se si preferisce tenere `AIRTABLE_TOKEN` in **sola lettura**, creare un secondo
token con accesso alla sola base *Love IT Projects* e `data.records:write`, e
metterlo su Vercel come:

| Variabile | Uso |
|---|---|
| `AIRTABLE_PROJECTS_TOKEN` | usato solo per scrivere in `Presentations` |

Se esiste, Presenta usa quello; altrimenti ricade su `AIRTABLE_TOKEN`. In questo
caso serve un redeploy, perché è una variabile nuova.

**Nota di confine (§0.1):** qualunque token si usi, Presenta scrive
esclusivamente sulla tabella `Presentations`. Clients, Quotes, Quote Lines e
l'intera base Fornitori non vengono mai toccati.

---

## Accesso con Google (§4.1 delle istruzioni di lavoro)

L'URL di produzione di Presenta è **https://full-presentation-builder.vercel.app**
— lo stesso che Preventivi apre con "Generate Presentation" e che il carrello
del Vault usa per l'handoff (§4.2).

Il Sign-In è **già implementato** (Google Identity Services, verifica del token
lato server in `api/acts.js`, solo dominio `loveit-dmc.com`, nessun ruolo: chi
entra può fare tutto quello che Presenta fa). Resta **spento** finché non è
configurata la variabile: senza, l'applicazione funziona come prima e nessuno
resta fuori per una configurazione mancante.

### Come accenderlo — nell'ordine

1. **Su Google Cloud**, nel Client ID
   `827028007345-dc89kfa95gp492nduioeoq9nrmm67q5q.apps.googleusercontent.com`,
   aggiungere agli **Authorized JavaScript origins**:

   ```
   https://full-presentation-builder.vercel.app
   http://localhost:3000                        (solo se si sviluppa in locale)
   ```

   Non servono Authorized redirect URIs: GIS restituisce il token a una callback
   JavaScript, non con un redirect.

   Nota sui **deploy di anteprima**: Vercel genera un indirizzo diverso ad ogni
   push (`…-abc123.vercel.app`) e Google **non accetta wildcard** fra gli
   origins. Sulle anteprime il login non si potrà quindi fare: l'app resta
   utilizzabile, ma il salvataggio in archivio risponderà "Accesso richiesto".
   È il comportamento voluto — meglio che una scrittura anonima.

2. **Su Vercel**, Settings → Environment Variables:

   | Variabile | Valore |
   |---|---|
   | `GOOGLE_CLIENT_ID` | `827028007345-dc89kfa95gp492nduioeoq9nrmm67q5q.apps.googleusercontent.com` |

   Non è un segreto (è pubblico per definizione in un client web), ma va tenuto
   in variabile e non nel codice: è quello che permette di spegnere il login
   senza rideployare.

3. **Ridistribuire** (o attendere il deploy successivo). Da quel momento in cima
   alla pagina compare la barra di accesso e il salvataggio in archivio registra
   l'email di chi ha generato la presentazione.

### Come verificare che sia acceso

```
curl https://full-presentation-builder.vercel.app/api/acts-list?auth=config
→ {"enabled":true,"clientId":"827028007345-…","domain":"loveit-dmc.com"}
```

`enabled:false` significa che la variabile non è arrivata alla funzione.

---

## Storage per l'archivio presentazioni (§4.4 / v61)

Fino alla v60 "Salva in archivio" scriveva solo titolo/template/fornitori su
Airtable — il campo `File` era un link che non serviva niente (nessuno storage
dietro). Da v61 l'HTML generato viene caricato davvero su **Vercel Blob**, e
"Le mie presentazioni" apre quel link.

**Passo unico, una tantum:**

1. Sul progetto in Vercel: **Storage → Create Database → Blob**.
2. Collega il nuovo Blob store al progetto `full-presentation-builder`
   (Vercel lo propone automaticamente dopo la creazione).
3. Questo aggiunge da solo la variabile `BLOB_READ_WRITE_TOKEN` su Vercel —
   non va copiata a mano da nessuna parte.
4. Ridistribuire (o attendere il prossimo deploy) perché la funzione veda la
   variabile.

Senza questo passo l'app **non si rompe**: il salvataggio su Airtable prosegue
comunque (titolo/template/fornitori restano consultabili), ma "Le mie
presentazioni" mostra "Non disponibile" al posto del pulsante Apri, e il
messaggio dopo il salvataggio lo dice esplicitamente.

---

## Svuotamento automatico del cestino presentazioni (v64)

Cancellare una presentazione dall'archivio (§4.4/v62) non la toglie subito da
Airtable — la marca solo come cancellata, così uno scatto involontario non
perde nulla. Da v64 un cron giornaliero può svuotare per davvero, dopo 30
giorni, quelle marcate. È spento finché non lo attivi:

1. Genera una stringa casuale lunga (es. `openssl rand -hex 32`, o qualunque
   password generator — non deve essere memorabile, solo imprevedibile).
2. Su Vercel: **Settings → Environment Variables**, aggiungi `CRON_SECRET`
   con quel valore, su Production.
3. Ridistribuisci. Da quel deploy in poi, ogni notte alle 3:00 UTC Vercel
   chiama l'endpoint di svuotamento da solo — non c'è altro da configurare,
   Vercel manda già l'header di autorizzazione giusto usando quella stessa
   variabile.

Senza `CRON_SECRET` l'endpoint risponde sempre "nessuna cancellazione
automatica attiva" e non tocca nulla: le presentazioni cancellate restano
nell'archivio (nascoste, non nell'elenco) finché non attivi questo passo o le
cancelli a mano da Airtable.

**Nota sul piano Vercel:** i cron su piano Hobby possono girare al massimo
una volta al giorno — questo cron gira esattamente una volta al giorno,
quindi va bene così com'è, non serve upgrade.

---

## Troubleshooting

**"Template file not found"** → Verifica che `template/loveit_template.html` sia nel repository.

**"Claude API error"** → Verifica che `ANTHROPIC_API_KEY` sia impostata correttamente in Vercel e che l'account Anthropic abbia credito.

**"Claude returned invalid JSON"** → Prova a rigenerare. A volte Claude aggiunge testo extra attorno al JSON — il sistema prova a ripulirlo ma in rari casi fallisce.

**Foto di bassa qualità** → Aggiungi `UNSPLASH_ACCESS_KEY` per ottenere foto specifiche per ogni attività.
