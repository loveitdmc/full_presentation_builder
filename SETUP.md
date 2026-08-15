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

## Troubleshooting

**"Template file not found"** → Verifica che `template/loveit_template.html` sia nel repository.

**"Claude API error"** → Verifica che `ANTHROPIC_API_KEY` sia impostata correttamente in Vercel e che l'account Anthropic abbia credito.

**"Claude returned invalid JSON"** → Prova a rigenerare. A volte Claude aggiunge testo extra attorno al JSON — il sistema prova a ripulirlo ma in rari casi fallisce.

**Foto di bassa qualità** → Aggiungi `UNSPLASH_ACCESS_KEY` per ottenere foto specifiche per ogni attività.
